import * as cheerio from "cheerio";
import { getText, parseDateLoose, parseTime, addDays, snapshot } from "../util.mjs";

/**
 * seret.co.il publishes each cinema's week as server-rendered HTML in
 * windows-1255. It is the fallback source for venues whose own site refuses
 * the refresh server. Each showtime carries the full date in its tooltip and
 * the same ticketing code the venue's own booking link uses.
 */
export async function scrapeSeretTheater(theaterId, siteId, { today, days, dbg, log }) {
  const url = `https://www.seret.co.il/movies/s_theatres.asp?TID=${theaterId}`;
  const html = await getText(url, { charset: "windows-1255" });
  const $ = cheerio.load(html);
  dbg.seretUrl = url;

  const lastDay = addDays(today, days - 1);
  const seen = new Set();
  const rows = [];

  $("div.cardGray").each((_, card) => {
    const $card = $(card);
    const title = $card.find("a.TitGreen20").first().text().replace(/\s+/g, " ").trim();
    if (!title) return;

    $card.find("div.stbox").each((__, box) => {
      const $box = $(box);
      // title="** לחצו לרכישת כרטיסים לשעה זו! | 22/9/2026 | *Upgrade..."
      const date = parseDateLoose(($box.attr("title") || "").match(/\d{1,2}\/\d{1,2}\/\d{4}/)?.[0], today);
      const time = parseTime($box.find("span.hour").first().text());
      if (!date || !time || date < today || date > lastDay) return;

      const code = ($box.attr("onclick") || "").match(/'(\d+-\d+)'/)?.[1] || null;
      const key = code ? `code:${code}` : `${title}|${date}|${time}`;
      if (seen.has(key)) return;
      seen.add(key);

      rows.push({
        date, time, title, titleEn: null, year: null, runtime: null,
        ticketUrl: code
          ? `https://ecom.biggerpicture.ai/site/${siteId}?code=${code}&saleChannelCode=web&languageid=he_IL`
          : url,
        infoUrl: url,
      });
    });
  });

  if (!rows.length) snapshot(dbg, "seret: nothing parsed", url, html);
  log(`seret(${theaterId}): ${rows.length} screenings in range`);
  return rows;
}
