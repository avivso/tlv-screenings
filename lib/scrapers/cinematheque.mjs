import * as cheerio from "cheerio";
import { getText, parseDateLoose, parseTime, addDays, sleep, snapshot } from "../util.mjs";

const DAY_URL = (date) => `https://www.cinema.co.il/shown/?date=${date}`;

/**
 * The Cinematheque's "by day" page is server-rendered and takes the day as a query
 * parameter, so each of the next N days is one plain fetch. Every screening has a
 * unique ticket link (cintlv.pres.global/order/<id>), which is what we key on.
 */
export async function scrapeCinematheque(_ctx, { today, days, dbg, log }) {
  const byOrder = new Map();
  const failures = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    try {
      if (i > 0) await sleep(800); // don't hammer the site; it throttles
      const { $, html } = await loadDay(date);
      if (i === 0) snapshot(dbg, `day ${date}`, DAY_URL(date), html);

      // The page prints the day it actually rendered; trust it over the requested date.
      const shown = parseDateLoose($("span.main-date").first().text(), today) ?? date;
      if (shown !== date) log(`cinematheque: asked for ${date}, page says ${shown}`);

      const rows = extractDay($, shown);
      let added = 0;
      for (const r of rows) {
        if (byOrder.has(r.orderId)) continue;
        byOrder.set(r.orderId, r);
        added++;
      }
      log(`cinematheque ${date}: ${rows.length} found, ${added} new`);
    } catch (e) {
      // One bad day must not cost us the other six.
      log(`cinematheque ${date} failed: ${e.message}`);
      failures.push(`${date}: ${e.message}`);
    }
  }

  if (failures.length) dbg.failedDays = failures;
  if (!byOrder.size && failures.length) throw new Error(`Every day failed. ${failures[0]}`);

  return [...byOrder.values()].map(({ orderId, ...row }) => row);
}

/**
 * Fetch one day and make sure the schedule really came back. When the site is
 * throttling it answers 200 in a few milliseconds with a page that has neither
 * the date header nor any film card, which would otherwise read as "no
 * screenings today". One slow retry is usually enough.
 */
async function loadDay(date) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(5000);
    const html = await getText(DAY_URL(date));
    const $ = cheerio.load(html);
    if ($("span.main-date").length) return { $, html };
    last = { $, html };
  }
  throw new Error("page came back without the schedule (the site is probably throttling us)");
}

/** Pull one day's screenings out of a loaded page. */
export function extractDay($, date) {
  const rows = [];
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  $("div.festival-grid-box").each((_, card) => {
    const $card = $(card);
    const $title = $card.find('div.title a[href*="/event/"]').first();
    const title = clean($title.text());
    if (!title) return;

    // "ישראל / 2026 / אורך:82"
    const meta = clean($card.find("div.title p").first().text())
      .match(/\/\s*(\d{4})\s*\/\s*(?:אורך|Length)\s*:?\s*(\d+)/);
    // Descriptions open with "Hebrew title | English Title" and then Hebrew prose.
    const en = clean($card.find("div.paragraph p").first().text())
      .match(/\|\s*([A-Za-z0-9"'¡¿(][^֐-׿|\n]{0,90})/);

    $card.find('a[href*="pres.global/order/"]').each((__, a) => {
      const href = $(a).attr("href") || "";
      const orderId = (href.match(/order\/(\d+)/) || [])[1];
      // In the by-time view some links read "להזמנה" instead of a clock time.
      const time = parseTime(clean($(a).text()));
      if (!orderId || !time) return;
      rows.push({
        orderId,
        date,
        time,
        title,
        titleEn: en ? en[1].trim().replace(/[\s.,:;!?\-–]+$/, "") : null,
        year: meta ? Number(meta[1]) : null,
        runtime: meta ? Number(meta[2]) : null,
        ticketUrl: href,
        infoUrl: $title.attr("href") || null,
      });
    });
  });

  return rows;
}
