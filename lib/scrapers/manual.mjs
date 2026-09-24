import { readFile } from "node:fs/promises";
import { parseDateLoose, parseTime } from "../util.mjs";

const FILE = "data/manual-venues.json";

export async function loadManualVenues() {
  try {
    const { _readme, ...venues } = JSON.parse(await readFile(FILE, "utf8"));
    return venues;
  } catch {
    return {};
  }
}

/**
 * Some venues only ever publish a monthly poster on Instagram. Instagram serves
 * captions to crawlers and to logged-in browsers, and to nothing else, so these
 * programmes are pasted into data/manual-venues.json by hand — once a month,
 * which is exactly how often they change.
 */
export function makeManualScraper(id, venue) {
  return async function scrapeManual(_ctx, { today, dbg, log }) {
    const rows = [];
    const seen = new Set();

    const add = (date, time, title) => {
      if (!date || !time || !title || date < today) return;
      const key = `${date}|${time}|${title}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        date, time, title: title.trim(), titleEn: null, year: null, runtime: null,
        ticketUrl: null, infoUrl: venue.source || venue.url || null,
      });
    };

    for (const s of venue.screenings || []) add(s.date, parseTime(s.time), s.title);

    // "15.9 | שלישי | 20:00 | מהיר ועצבני 1" — the day name is optional.
    const hint = venue.year ? `${venue.year}-01-01` : today;
    for (const line of venue.paste || []) {
      const parts = String(line).split("|").map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3) continue;
      const date = parseDateLoose(parts[0], hint);
      const time = parseTime(parts.find((p) => parseTime(p) && p.length <= 6));
      const title = parts[parts.length - 1];
      if (date && time && title !== parts[0]) add(date, time, title);
    }

    rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    dbg.fromFile = FILE;
    dbg.pasteLines = (venue.paste || []).length;
    log(`${id}: ${rows.length} screenings from ${FILE}`);
    return rows;
  };
}
