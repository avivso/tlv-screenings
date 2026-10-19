import { getText } from "../util.mjs";

const ORIGIN = "https://www.tamuseum.org.il";
const API = `${ORIGIN}/api/v2/he/events/filter/?category=film`;

/**
 * Tel Aviv Museum of Art: the film programme ("Cinema Museum", weekend
 * strands). Its events page is filled from a JSON API that groups events by
 * day, each titled like "<i>Series</i>: … / <i>The Graduate</i>, 1967".
 */
export async function scrapeMuseum(_ctx, { today, dbg, log }) {
  const byUrl = new Map();
  let offset = 0;
  let total = Infinity;

  for (let page = 0; page < 10 && offset < total; page++) {
    const data = JSON.parse(await getText(`${API}&offset=${offset}`, { headers: { accept: "application/json" } }));
    total = data.meta?.total_count ?? 0;
    const events = Object.values(data.items || {}).flat();
    if (!events.length) break;
    for (const ev of events) byUrl.set(ev.url, ev);
    offset += events.length;
  }
  dbg.eventsReturned = byUrl.size;

  const rows = [];
  for (const ev of byUrl.values()) {
    const [date, clock] = String(ev.date || "").split("T");
    const time = clock?.slice(0, 5);
    if (!date || !time || date < today) continue;
    const { title, year } = filmFrom(ev.title);
    if (!title) continue;
    rows.push({
      date, time, title, titleEn: null, year, runtime: null,
      ticketUrl: ORIGIN + ev.url, infoUrl: ORIGIN + ev.url,
    });
  }

  rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  log(`museum: ${rows.length} screenings`);
  return rows;
}

/**
 * The film is the last part of the title: "<i>הבוגר</i>, 1967". Its name is
 * the last italic run there and its year the last four-digit year.
 */
export function filmFrom(raw) {
  const last = String(raw || "").split(" / ").pop();
  const italics = [...last.matchAll(/<i>([^<]+)<\/i>/g)].map((m) => m[1].trim());
  const year = Number((last.match(/(19|20)\d{2}(?!.*(19|20)\d{2})/) || [])[0]) || null;
  const title = (italics.pop() || last.replace(/<[^>]+>/g, "").replace(/,?\s*(19|20)\d{2}.*$/, "")).trim();
  return { title, year };
}
