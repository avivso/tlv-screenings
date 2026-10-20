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

    // Two caption shapes so far:
    //   monthly: "15.9 | שלישי | 20:00 | מהיר ועצבני 1"   (title on the date line)
    //   weekly:  "השבוע על המסך: אני רובוט | I Robot" … "שלישי | 20.10 | 20:00"
    // So each line is read for a date part, a time part and maybe a title; a
    // date line with no title takes the caption's "on screen" film.
    const hint = venue.year ? `${venue.year}-01-01` : today;
    const lines = (venue.paste || []).map(String);
    const headline = lines.map((l) => l.match(/על המסך\s*[:：]\s*(.+)$/)).find(Boolean)?.[1];
    const featured = headline?.split("|").map((p) => p.trim()).filter(Boolean)[0];

    for (const line of lines) {
      const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const di = parts.findIndex((p) => /^\d{1,2}\.\d{1,2}(\.\d{2,4})?$/.test(p));
      const ti = parts.findIndex((p) => /^\d{1,2}:\d{2}$/.test(p));
      if (di < 0 || ti < 0) continue;
      const date = parseDateLoose(parts[di], hint);
      const time = parseTime(parts[ti]);
      // Whatever is left after the date, the time and a day name is the title.
      const rest = parts.filter((_, i) => i !== di && i !== ti && !/^(יום\s*)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)$/.test(parts[i]));
      add(date, time, rest[rest.length - 1] || featured);
    }

    rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    dbg.fromFile = FILE;
    dbg.pasteLines = (venue.paste || []).length;
    log(`${id}: ${rows.length} screenings from ${FILE}`);
    return rows;
  };
}
