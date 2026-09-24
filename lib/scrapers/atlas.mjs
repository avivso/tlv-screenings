import * as cheerio from "cheerio";
import { getText, parseDateLoose, parseTime, addDays, snapshot } from "../util.mjs";

// atlas.co.il itself is behind a hard Cloudflare block, but the rooftop page is
// only a shell around this ticketing widget, which serves plain HTML to anyone.
const WIDGET =
  "https://activity.hotelplus.io/?post_type=giftcards&p=271570&provider_id=284&lang=He&agent_pid=false&only_form=0&direct_pid=false";
export const PAGE = "https://www.atlas.co.il/rooftop-cinema/";

/**
 * Rooftop Cinema on the roof of the Cinema Hotel: one classic a night, sold as
 * a ticketed "activity". Every card's title reads "<film> | D.M.YY | HH:MM".
 */
export async function scrapeAtlas(_ctx, { today, days, dbg, log }) {
  const html = await getText(WIDGET);
  const $ = cheerio.load(html);
  dbg.widgetUrl = WIDGET;

  const lastDay = addDays(today, 120); // it sells a couple of months ahead
  const rows = [];
  const seen = new Set();

  $("a.activity_grid_item").each((_, a) => {
    const $a = $(a);
    const label = $a.find(".activity_grid_title").first().text().replace(/\s+/g, " ").trim();
    // "מאמה מיה | 19.9.26 | 20:00" — anything without that shape is not a screening.
    const parts = label.split("|").map((p) => p.trim());
    if (parts.length < 3) return;
    const [title, rawDate, rawTime] = parts;
    const date = parseDateLoose(rawDate, today);
    const time = parseTime(rawTime);
    if (!title || !date || !time || date < today || date > lastDay) return;

    const id = $a.attr("data-pid") || `${title}|${date}|${time}`;
    if (seen.has(id)) return;
    seen.add(id);

    rows.push({
      date, time, title, titleEn: null, year: null, runtime: null,
      // Sold-out cards stay listed: the screening is still happening.
      soldOut: $a.find(".out_of_stock").length > 0 || undefined,
      ticketUrl: $a.attr("href") || PAGE,
      infoUrl: PAGE,
    });
  });

  if (!rows.length) snapshot(dbg, "atlas: nothing parsed", WIDGET, html);
  log(`atlas: ${rows.length} screenings`);
  return rows;
}
