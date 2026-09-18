import * as cheerio from "cheerio";
import { getText, parseDateLoose, parseTime, addDays, pool, snapshot } from "../util.mjs";

const HOME = "https://www.jaffacinema.com/";
const SITEMAP = "https://www.jaffacinema.com/calendar-sitemap.xml";

/**
 * Jaffa Cinema is a WordPress site. Each screening has its own page at
 * /calendar/<id>/ whose <title> reads "DD/MM/YYYY HH:MM | Name - קולנוע יפו".
 * The /calendar/ index page is gone (it 404s), but the home page links every
 * upcoming screening; the sitemap is a backstop if that layout changes.
 */
export async function scrapeJaffa(_ctx, { today, days, dbg, log }) {
  const lastDay = addDays(today, 120); // the home page lists a couple of weeks ahead

  let links = [];
  try {
    links = await homeLinks(dbg);
    dbg.linksFromHome = links.length;
  } catch (e) {
    dbg.homeError = e.message;
    log(`jaffa: home page unavailable (${e.message}); trying the sitemap`);
  }
  if (!links.length) {
    links = await sitemapLinks();
    dbg.linksFromSitemap = links.length;
  }
  if (!links.length) throw new Error("No /calendar/<id>/ links found on the home page or in the sitemap");

  // Newest ids first: those are the screenings being programmed now.
  links.sort((a, b) => idOf(b) - idOf(a));
  const pages = await pool(links.slice(0, 120), 4, async (url) => {
    try {
      const html = await getText(url, { retries: 1 });
      const title = decode((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "");
      return { url, ...(parseTitleLine(title, today) || {}) };
    } catch {
      return null;
    }
  });

  const rows = [];
  for (const p of pages) {
    if (!p?.date || !p.time || !p.title) continue;
    if (p.date < today || p.date > lastDay) continue;
    rows.push({
      date: p.date, time: p.time, title: p.title,
      titleEn: null, year: null, runtime: null,
      ticketUrl: p.url, infoUrl: p.url,
    });
  }

  rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  log(`jaffa: ${rows.length} screenings in range (${links.length} calendar links)`);
  return rows;
}

const idOf = (url) => Number((url.match(/\/calendar\/(\d+)/) || [])[1]) || 0;

async function homeLinks(dbg) {
  const html = await getText(HOME);
  const $ = cheerio.load(html);
  const urls = new Set();
  $('a[href*="/calendar/"]').each((_, a) => {
    const href = new URL($(a).attr("href"), HOME).href;
    if (/\/calendar\/\d+\/?$/.test(href)) urls.add(href);
  });
  if (!urls.size) snapshot(dbg, "no calendar links on home", HOME, html);
  return [...urls];
}

async function sitemapLinks() {
  const xml = await getText(SITEMAP);
  const urls = [...xml.matchAll(/<loc>([^<]*\/calendar\/\d+\/?)<\/loc>/g)].map((m) => m[1]);
  return [...new Set(urls)];
}

/** "28/09/2026 20:00 | מרי פופינס - קולנוע יפו | Jaffa Cinema" */
export function parseTitleLine(text, today) {
  const m = String(text).match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})\s*\|\s*(.+)$/);
  if (!m) return null;
  const title = m[3]
    .replace(/\s*[-–|]\s*קולנוע יפו.*$/, "")
    .replace(/\s*[-–|]\s*Jaffa Cinema.*$/i, "")
    .trim();
  if (!title) return null;
  return { date: parseDateLoose(m[1], today), time: parseTime(m[2]), title };
}

function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
