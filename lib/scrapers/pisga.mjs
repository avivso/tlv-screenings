import { readFile, writeFile } from "node:fs/promises";
import { getText, parseTime, addDays, pool } from "../util.mjs";

const FEED = "https://www.be106.net/rss/city/255/posts.xml"; // BE106's Tel Aviv-Jaffa news feed
const SECTION = "https://www.be106.net/255";
const STORE = "data/pisga-seen.json";
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
// Only real quotation marks: a geresh (׳) or apostrophe belongs inside titles
// like "סנאץ׳" and must not end one.
const QUOTE = `"״“”`;

/**
 * Cinema HaPisga (Gan HaPisga, Old Jaffa) has no schedule page: the Old Jaffa
 * Development Corporation announces each month through the local press, and
 * BE106 writes every one of them up in plain HTML.
 *
 * Its news feed only holds the last few articles, so a screening found once is
 * remembered in data/pisga-seen.json, which the workflow commits. That way a
 * screening does not vanish from the site when the article scrolls away.
 */
export async function scrapePisga(_ctx, { today, dbg, log }) {
  const remembered = await readStore();
  let found = [];

  try {
    const xml = await getText(FEED);
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    dbg.feedItems = items.length;

    const matched = items.filter((it) => /גן הפסגה|קולנוע הפסגה/.test(it));
    dbg.itemsMatched = matched.length;
    for (const item of matched) {
      const link = field(item, "link") || SECTION;
      found.push(...parseArticle(`${field(item, "title")}. ${field(item, "description")}`, link));
    }
  } catch (e) {
    // The press feed is a courtesy, not a contract: remembered screenings stand.
    dbg.feedError = e.message;
    log(`pisga: could not read the press feed (${e.message})`);
  }

  const byKey = new Map(remembered.map((r) => [`${r.date}|${r.time}|${r.title}`, r]));
  let added = 0;
  for (const r of found) {
    const key = `${r.date}|${r.time}|${r.title}`;
    if (byKey.has(key)) continue;
    byKey.set(key, r);
    added++;
  }

  // Forget what has already happened so the file cannot grow without end.
  const kept = [...byKey.values()].filter((r) => r.date >= addDays(today, -1));
  await writeStore(kept);

  const rows = kept
    .filter((r) => r.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .map((r) => ({
      date: r.date, time: r.time, title: r.title,
      titleEn: null, year: null, runtime: null,
      ticketUrl: null, infoUrl: r.source || SECTION,
    }));

  log(`pisga: ${rows.length} screenings (${added} newly announced)`);
  return rows;
}

/**
 * One item's prose, e.g. "…יוקרן במסגרת קולנוע הפסגה ביום רביעי, 30 בספטמבר
 * 2026, בשעה 21:00…". The film's name is in quotes, sometimes before the date
 * and sometimes after, so each date is paired with the nearest quoted phrase.
 */
export function parseArticle(text, url) {
  const when = [...text.matchAll(
    new RegExp(String.raw`(\d{1,2})\s+ב(${MONTHS.join("|")})\s*(\d{4})?[\s\S]{0,80}?בשעה\s*(\d{1,2}:\d{2})`, "g"),
  )];
  const titles = [...text.matchAll(new RegExp(String.raw`[${QUOTE}]([^${QUOTE}\n]{2,60})[${QUOTE}]`, "g"))];
  if (!when.length || !titles.length) return [];

  const out = [];
  const seen = new Set();
  for (const m of when) {
    const [, day, monthName, year, rawTime] = m;
    const month = MONTHS.indexOf(monthName) + 1;
    const time = parseTime(rawTime);
    if (!month || !time) continue;

    const near = titles
      .map((t) => ({ title: t[1].trim(), gap: Math.abs(t.index - m.index) }))
      .filter((t) => t.gap < 400)
      .sort((a, b) => a.gap - b.gap)[0];
    if (!near) continue;

    const date = `${year || new Date().getFullYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const key = `${date}|${time}|${near.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, time, title: near.title, source: url });
  }
  return out;
}

/** One field out of an RSS item, CDATA and entities unwrapped. */
function field(item, tag) {
  const m = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  return stripTags(m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, ""));
}

function stripTags(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

const readStore = async () => {
  try { return JSON.parse(await readFile(STORE, "utf8")); } catch { return []; }
};
const writeStore = (rows) => writeFile(STORE, JSON.stringify(rows, null, 2));
