// scripts/actions.mjs
import puppeteer from "puppeteer";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// lib/util.mjs
var TZ = "Asia/Jerusalem";
function ilDate(d = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
var pad = (n) => String(n).padStart(2, "0");
function parseDateLoose(s, todayIso) {
  if (!s) return null;
  s = String(s);
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})(?!\d)/);
  if (m) {
    const y = m[3].length === 2 ? 2e3 + Number(m[3]) : Number(m[3]);
    return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  m = s.match(/(?<![\d./])(\d{1,2})[./](\d{1,2})(?![\d./])/);
  if (m && todayIso) {
    const y = Number(todayIso.slice(0, 4));
    let iso = `${y}-${pad(m[2])}-${pad(m[1])}`;
    if (iso < addDays(todayIso, -30)) iso = `${y + 1}-${pad(m[2])}-${pad(m[1])}`;
    return iso;
  }
  return null;
}
function parseTime(s) {
  const m = String(s ?? "").match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  return m ? `${pad(m[1])}:${m[2]}` : null;
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
async function snapshot(page, dbg, label) {
  try {
    dbg.pages ??= [];
    dbg.pages.push({ label, url: page.url(), html: (await page.content()).slice(0, 15e4) });
  } catch {
  }
}

// lib/scrapers/cinematheque.mjs
var URL2 = "https://www.cinema.co.il/shown/";
async function scrapeCinematheque(browser2, { today, days, dbg, log }) {
  const page = await browser2.newPage();
  const byOrder = /* @__PURE__ */ new Map();
  try {
    await page.goto(URL2, { waitUntil: "networkidle2", timeout: 6e4 });
    const lastDay = addDays(today, days - 1);
    for (let i = 0; i < days; i++) {
      const { label, results } = await page.evaluate(extractDay);
      const date = parseDateLoose(label, today) ?? addDays(today, i);
      if (date > lastDay) break;
      let added = 0;
      for (const r of results) {
        if (byOrder.has(r.orderId)) continue;
        byOrder.set(r.orderId, { ...r, date });
        added++;
      }
      log(`cinematheque ${date}: ${results.length} found, ${added} new`);
      if (i === 0) await snapshot(page, dbg, `day ${date}`);
      if (i === days - 1) break;
      const moved = await goToNextDay(page, label);
      if (!moved) {
        dbg.stoppedAt = date;
        await snapshot(page, dbg, `next-day click failed after ${date}`);
        if (i === 0) throw new Error("Could not move past today (date arrow not found or did nothing)");
        break;
      }
    }
  } finally {
    await page.close().catch(() => {
    });
  }
  return [...byOrder.values()].map((r) => ({
    date: r.date,
    time: r.time,
    title: r.title,
    titleEn: r.titleEn,
    year: r.year,
    runtime: r.runtime,
    ticketUrl: r.ticketUrl,
    infoUrl: r.eventUrl
  }));
}
async function goToNextDay(page, prevLabel) {
  const clicked = await page.evaluate(() => {
    const arrows = [...document.querySelectorAll('img[src*="left-arrow"]')];
    const arrow = arrows.find((a) => a.offsetParent !== null) ?? arrows[0];
    if (!arrow) return false;
    (arrow.closest("a,button") ?? arrow).click();
    return true;
  });
  if (!clicked) return false;
  for (let t = 0; t < 40; t++) {
    await sleep(500);
    try {
      const label = await page.evaluate(() => {
        const re = /\d{2}\.\d{2}\.\d{2}/;
        const arrow = document.querySelector('img[src*="left-arrow"]');
        for (let box = arrow, i = 0; box && i < 5; i++, box = box.parentElement) {
          const text = (box.textContent || "").replace(/\s+/g, " ");
          const m = text.match(re);
          if (m && text.length < 120) return m[0];
        }
        return null;
      });
      if (label && label !== prevLabel) {
        await sleep(1500);
        return true;
      }
    } catch {
    }
  }
  return false;
}
function extractDay() {
  const TIME = /^\d{1,2}:\d{2}$/;
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  let label = null;
  const arrow = document.querySelector('img[src*="left-arrow"]');
  for (let box = arrow, i = 0; box && i < 5; i++, box = box.parentElement) {
    const text = clean(box.textContent);
    const m = text.match(/\d{2}\.\d{2}\.\d{2}/);
    if (m && text.length < 120) {
      label = m[0];
      break;
    }
  }
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  for (const a of document.querySelectorAll('a[href*="pres.global/order/"]')) {
    if (a.closest("nav, header, [class*='menu'], [id*='menu']")) continue;
    const time = clean(a.textContent);
    if (!TIME.test(time)) continue;
    const orderId = (a.href.match(/order\/(\d+)/) || [])[1];
    if (!orderId || seen.has(orderId)) continue;
    let card = a.parentElement;
    let titleLink = null;
    for (let i = 0; card && i < 8; i++, card = card.parentElement) {
      titleLink = [...card.querySelectorAll('a[href*="/event/"]')].find((x) => {
        const t = clean(x.textContent);
        return t.length > 1 && !TIME.test(t) && !/^https?:/.test(t) && !/לפרטים|להזמנה|details|tickets/i.test(t);
      });
      if (titleLink) break;
    }
    if (!titleLink) continue;
    seen.add(orderId);
    const text = card.innerText || card.textContent || "";
    const meta = text.match(/\/\s*(\d{4})\s*\/\s*(?:אורך|Length)\s*:?\s*(\d+)/);
    const en = text.match(/\|\s*([A-Za-z0-9"'¡¿(][^\u0590-\u05FF|\n]{0,90})/);
    results.push({
      orderId,
      time: time.padStart(5, "0"),
      title: clean(titleLink.textContent),
      titleEn: en ? en[1].trim().replace(/[\s.,:;!?\-–]+$/, "") : null,
      year: meta ? Number(meta[1]) : null,
      runtime: meta ? Number(meta[2]) : null,
      eventUrl: titleLink.href,
      ticketUrl: a.href
    });
  }
  return { label, results };
}

// lib/scrapers/movieland.mjs
var THEATER = 1293;
var PAGE = `https://movieland.co.il/theater/${THEATER}`;
async function scrapeMovieland(browser2, { today, days, dbg, log }) {
  const page = await browser2.newPage();
  const payloads = [];
  page.on("response", async (res) => {
    try {
      const type = res.headers()["content-type"] || "";
      const url = res.url();
      if (!/json/i.test(type) && !/api|event|show|movie|schedule/i.test(url)) return;
      if (/\.(js|css|png|jpe?g|svg|webp|woff2?)(\?|$)/i.test(url)) return;
      const text = await res.text();
      if (!/^[\s]*[\[{]/.test(text)) return;
      payloads.push({ url, json: JSON.parse(text) });
    } catch {
    }
  });
  try {
    await page.goto(`https://movieland.co.il/select-branch/${THEATER}?returnUrl=%2Ftheater%2F${THEATER}`, {
      waitUntil: "networkidle2",
      timeout: 6e4
    });
    if (!page.url().includes(`/theater/${THEATER}`)) {
      await page.goto(PAGE, { waitUntil: "networkidle2", timeout: 6e4 });
    }
    await sleep(3e3);
    let rows = collect(payloads, today);
    if (!rows.length) {
      await page.evaluate(() => {
        const target = [...document.querySelectorAll("a,button")].find((el) => /לוח הקרנות|FEED הקרנות|תאריכים נוספים/.test(el.textContent || ""));
        target?.click();
      });
      await sleep(5e3);
      rows = collect(payloads, today);
    }
    dbg.jsonUrls = payloads.map((p) => p.url);
    if (!rows.length) {
      dbg.jsonSamples = payloads.slice(0, 5).map((p) => ({ url: p.url, sample: JSON.stringify(p.json).slice(0, 4e3) }));
      await snapshot(page, dbg, "no showtimes parsed");
    }
    const lastDay = addDays(today, days - 1);
    rows = rows.filter((r) => r.date >= today && r.date <= lastDay);
    log(`movieland: ${rows.length} screenings from ${payloads.length} JSON responses`);
    return rows;
  } finally {
    await page.close().catch(() => {
    });
  }
}
function collect(payloads, today) {
  const seen = /* @__PURE__ */ new Set();
  const rows = [];
  for (const { json } of payloads) {
    for (const ev of findEvents(json)) {
      const title = String(ev.Name ?? ev.name ?? ev.Title ?? ev.title).trim();
      const runtime = Number(ev.LengthInMinutes ?? ev.Length ?? ev.Duration) || null;
      const dates = ev.Dates ?? ev.dates ?? ev.Showtimes ?? ev.showtimes ?? ev.Sessions ?? ev.sessions;
      for (const d of dates) {
        for (const { date, time } of showtimesIn(d, today)) {
          const key = `${title}|${date}|${time}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({ date, time, title, titleEn: null, year: null, runtime, ticketUrl: PAGE, infoUrl: PAGE });
        }
      }
    }
  }
  return rows;
}
function findEvents(node, out = [], depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return out;
  if (Array.isArray(node)) {
    for (const n of node) findEvents(n, out, depth + 1);
    return out;
  }
  const name = node.Name ?? node.name ?? node.Title ?? node.title;
  const dates = node.Dates ?? node.dates ?? node.Showtimes ?? node.showtimes ?? node.Sessions ?? node.sessions;
  if (typeof name === "string" && Array.isArray(dates) && dates.length) {
    out.push(node);
    return out;
  }
  for (const v of Object.values(node)) findEvents(v, out, depth + 1);
  return out;
}
function showtimesIn(entry, today) {
  const strings = [];
  (function walk(v, depth) {
    if (depth > 5 || v == null) return;
    if (typeof v === "string" || typeof v === "number") strings.push(String(v));
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (typeof v === "object") Object.values(v).forEach((x) => walk(x, depth + 1));
  })(entry, 0);
  const out = [];
  for (const s of strings) {
    const m = s.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (m) out.push({ date: m[1], time: m[2] });
  }
  if (out.length) return out;
  const dayField = typeof entry === "object" ? entry.Day ?? entry.Date ?? entry.day ?? entry.date : entry;
  const date = parseDateLoose(dayField, today) ?? strings.map((s) => parseDateLoose(s, today)).find(Boolean);
  if (!date) return out;
  for (const s of strings) {
    if (s === dayField) continue;
    const time = parseTime(s);
    if (time && /^\D{0,3}\d{1,2}:\d{2}(:\d{2})?\D{0,3}$/.test(s.trim())) out.push({ date, time });
  }
  return out;
}

// lib/scrapers/jaffa.mjs
var CALENDAR = "https://www.jaffacinema.com/calendar/";
async function scrapeJaffa(browser2, { today, days, dbg, log }) {
  const lastDay = addDays(today, days - 1);
  const page = await browser2.newPage();
  let links = [];
  let blocks = [];
  try {
    await page.goto(CALENDAR, { waitUntil: "networkidle2", timeout: 6e4 });
    dbg.finalUrl = page.url();
    links = await page.evaluate(() => {
      const seen = /* @__PURE__ */ new Set();
      return [...document.querySelectorAll("a[href]")].filter((a) => /\/calendar\/\d+\/?$/.test(a.href)).filter((a) => seen.has(a.href) ? false : seen.add(a.href)).map((a) => ({ href: a.href, text: (a.closest("article,li,.event,.item") || a).innerText?.slice(0, 300) || "" }));
    });
    if (!links.length) {
      blocks = await page.evaluate(genericBlocks);
      await snapshot(page, dbg, "no calendar links");
    }
  } finally {
    await page.close().catch(() => {
    });
  }
  const rows = [];
  if (links.length) {
    const details = await pool(links.slice(0, 80), 6, async (l) => {
      const fromList = parseTitleLine(l.text, today);
      if (fromList) return { ...fromList, url: l.href };
      try {
        const res = await fetch(l.href, { headers: { "user-agent": UA } });
        const html = await res.text();
        const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || "";
        const parsed = parseTitleLine(decode(title), today);
        return parsed ? { ...parsed, url: l.href } : null;
      } catch {
        return null;
      }
    });
    for (const d of details) if (d) rows.push(d);
  } else {
    for (const b of blocks) {
      const date = parseDateLoose(b.text, today);
      const time = parseTime(b.text);
      if (date && time && b.title) rows.push({ date, time, title: b.title, url: b.href || CALENDAR });
    }
  }
  dbg.linksFound = links.length;
  const result = rows.filter((r) => r.date >= today && r.date <= lastDay).map((r) => ({
    date: r.date,
    time: r.time,
    title: r.title,
    titleEn: null,
    year: null,
    runtime: null,
    ticketUrl: r.url,
    infoUrl: r.url
  }));
  log(`jaffa: ${result.length} screenings in range (${links.length} calendar links)`);
  return result;
}
function parseTitleLine(text, today) {
  const m = String(text).match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})\s*\|\s*(.+?)(?:\s*[-–|]\s*קולנוע יפו.*)?$/m);
  if (!m) return null;
  return { date: parseDateLoose(m[1], today), time: parseTime(m[2]), title: m[3].trim() };
}
function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");
}
function genericBlocks() {
  const DATE = /\d{1,2}[./]\d{1,2}/;
  const TIME = /\d{1,2}:\d{2}/;
  const hits = [];
  for (const el of document.querySelectorAll("body *")) {
    const t = el.innerText || "";
    if (t.length > 400 || !DATE.test(t) || !TIME.test(t)) continue;
    const child = [...el.children].some((c) => DATE.test(c.innerText || "") && TIME.test(c.innerText || ""));
    if (child) continue;
    const title = t.split("\n").map((s) => s.trim()).find((s) => s.length > 1 && !DATE.test(s) && !TIME.test(s));
    hits.push({ text: t, title, href: el.closest("a")?.href || el.querySelector("a")?.href });
  }
  return hits;
}

// lib/overrides.mjs
var overrides_default = {};

// lib/titles.mjs
function cleanTitle(raw) {
  if (!raw) return "";
  let t = String(raw);
  t = t.replace(/^\s*(MovieRetro|MovieNights|מועדון סרטי איכות|ראשון שיגעון|שלישי בשלייקס|מועדון 60\+|אפטר בסינמטק|Teen Screen)\s*[-–:|]\s*/i, "");
  t = t.replace(/\((מדובב|מתורגם|כתוביות|אנגלית|עברית|dubbed|subtitled)\)/gi, "");
  t = t.replace(/(^|\s)(בטרום בכורה|טרום בכורה|הקרנת בכורה|הדרן)(?=\s|$)/g, " ");
  t = t.replace(/\s*[-–]\s*חגיגות\s*\d+\s*שנה.*$/, "");
  t = t.replace(/\s*[-–]\s*(\d+)(th)?\s*anniversary.*$/i, "");
  t = t.replace(/\s*[-–]?\s*(3D|4DX|IMAX|VIP)\b/gi, "");
  t = t.replace(/["“”„״'׳]/g, "");
  return t.replace(/\s+/g, " ").trim();
}
function isRetroLabel(raw) {
  return /MovieRetro|הדרן|חגיגות\s*\d+\s*שנה|anniversary|קלאסיקה|classic/i.test(String(raw || ""));
}
function filmKey({ title, titleEn, year }) {
  const base = (titleEn || cleanTitle(title)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${base}|${year ?? ""}`;
}

// lib/ratings.mjs
var TMDB = "https://api.themoviedb.org/3";
var OMDB = "https://www.omdbapi.com/";
var HIT_TTL = 14 * 864e5;
var MISS_TTL = 3 * 864e5;
async function getRatings(film, { env, cache: cache2, log = () => {
} }) {
  const cacheKey = `film:${film.key}`;
  const cached = await cache2.get(cacheKey);
  if (cached) {
    const age = Date.now() - cached.fetchedAt;
    if (age < (cached.data.imdbId ? HIT_TTL : MISS_TTL)) return cached.data;
  }
  let data;
  try {
    data = await lookup(film, env);
  } catch (e) {
    log(`ratings lookup failed for "${film.title}": ${e.message}`);
    return cached?.data ?? emptyRatings(film);
  }
  await cache2.set(cacheKey, { fetchedAt: Date.now(), data });
  return data;
}
function emptyRatings(film) {
  return { query: cleanTitle(film.title), imdbId: null, match: "none" };
}
async function lookup(film, env) {
  const clean = cleanTitle(film.title);
  const result = { query: clean, imdbId: null, match: "none" };
  const override = overrides_default[clean] || film.titleEn && overrides_default[film.titleEn];
  if (override) {
    result.imdbId = override;
    result.match = "override";
  }
  if (!result.imdbId && env.TMDB_API_KEY) {
    const hint = { year: film.year, recent: !film.year && !film.retro };
    let hit = null;
    if (film.titleEn) hit = await tmdbSearch(film.titleEn, "en-US", hint, env);
    if (!hit && clean) hit = await tmdbSearch(clean, "he-IL", hint, env);
    if (hit) {
      const det = await getJson(`${TMDB}/movie/${hit.movie.id}?api_key=${env.TMDB_API_KEY}&append_to_response=external_ids`);
      Object.assign(result, {
        imdbId: det?.external_ids?.imdb_id || det?.imdb_id || null,
        match: hit.exact ? "exact" : "fuzzy",
        titleEn: det?.title,
        year: det?.release_date ? Number(det.release_date.slice(0, 4)) : null,
        tmdbRating: det?.vote_count >= 20 ? round1(det.vote_average) : null,
        poster: det?.poster_path ? `https://image.tmdb.org/t/p/w185${det.poster_path}` : null
      });
    }
  }
  if (!result.imdbId && env.OMDB_API_KEY && film.titleEn) {
    const o = await getJson(`${OMDB}?apikey=${env.OMDB_API_KEY}&type=movie&t=${encodeURIComponent(film.titleEn)}${film.year ? `&y=${film.year}` : ""}`);
    if (o?.Response === "True") Object.assign(result, { imdbId: o.imdbID, match: "fuzzy" });
  }
  if (result.imdbId && env.OMDB_API_KEY) {
    const o = await getJson(`${OMDB}?apikey=${env.OMDB_API_KEY}&i=${result.imdbId}`);
    if (o?.Response === "True") {
      const rt = o.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value;
      Object.assign(result, {
        titleEn: result.titleEn || o.Title,
        year: result.year || Number(String(o.Year).slice(0, 4)) || null,
        imdbRating: num(o.imdbRating),
        imdbVotes: num(String(o.imdbVotes || "").replace(/,/g, "")),
        rottenTomatoes: rt ? num(rt.replace("%", "")) : null,
        metacritic: num(o.Metascore),
        poster: result.poster || (o.Poster && o.Poster !== "N/A" ? o.Poster : null)
      });
    }
  }
  return result;
}
async function tmdbSearch(query, language, { year, recent }, env) {
  const base = `${TMDB}/search/movie?api_key=${env.TMDB_API_KEY}&include_adult=false&language=${language}&query=${encodeURIComponent(query)}`;
  let data = await getJson(year ? `${base}&year=${year}` : base);
  if (year && !data?.results?.length) data = await getJson(base);
  const results = (data?.results || []).slice(0, 8);
  if (!results.length) return null;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const q = norm(query);
  const thisYear = (/* @__PURE__ */ new Date()).getFullYear();
  const scored = results.map((m, i) => {
    const y = Number((m.release_date || "").slice(0, 4)) || 0;
    const exact = norm(m.title) === q || norm(m.original_title) === q;
    let score = 10 - i + Math.log10((m.vote_count || 0) + 1);
    if (exact) score += 20;
    if (year && y === year) score += 15;
    if (year && Math.abs(y - year) === 1) score += 6;
    if (recent && y >= thisYear - 1) score += 12;
    return { movie: m, exact, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}
async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 401) throw new Error(`API key rejected by ${new URL(url).host}`);
  if (!res.ok) return null;
  return res.json();
}
var num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== "N/A" && v !== "" ? n : null;
};
var round1 = (n) => Math.round(n * 10) / 10;

// lib/build.mjs
var VENUES = {
  cinematheque: { name: "Cinematheque", scrape: scrapeCinematheque },
  movieland: { name: "Movieland HaTzuk", scrape: scrapeMovieland },
  jaffa: { name: "Jaffa Cinema", scrape: scrapeJaffa }
};
async function buildListings({ browser: browser2, env, cache: cache2, days = 7, log = console.log }) {
  const today = ilDate();
  const debug = { startedAt: (/* @__PURE__ */ new Date()).toISOString(), venues: {} };
  const errors = [];
  const screenings = [];
  for (const [id, venue] of Object.entries(VENUES)) {
    const dbg = debug.venues[id] = {};
    const t0 = Date.now();
    try {
      const rows = await venue.scrape(browser2, { today, days, dbg, log });
      dbg.count = rows.length;
      if (!rows.length) errors.push({ venue: id, message: "No screenings found on the last refresh." });
      for (const r of rows) screenings.push({ ...r, venue: id });
    } catch (e) {
      log(`${id} failed: ${e.stack || e}`);
      dbg.error = String(e.stack || e);
      errors.push({ venue: id, message: String(e.message || e) });
    }
    dbg.ms = Date.now() - t0;
  }
  const films = {};
  for (const s of screenings) {
    s.retro = isRetroLabel(s.title);
    s.filmKey = filmKey(s);
    films[s.filmKey] ??= { key: s.filmKey, title: s.title, titleEn: s.titleEn, year: s.year, retro: s.retro };
  }
  const list = Object.values(films);
  if (env.OMDB_API_KEY || env.TMDB_API_KEY) {
    await pool(list, 4, async (f) => {
      f.ratings = await getRatings(f, { env, cache: cache2, log });
    });
  } else {
    errors.push({ venue: null, message: "No TMDB_API_KEY or OMDB_API_KEY set, so ratings are missing." });
  }
  const out = {};
  for (const f of list) {
    const r = f.ratings || {};
    out[f.key] = {
      titleEn: f.titleEn || r.titleEn || null,
      year: f.year || r.year || null,
      imdbId: r.imdbId || null,
      match: r.match || "none",
      imdbRating: r.imdbRating ?? null,
      imdbVotes: r.imdbVotes ?? null,
      rottenTomatoes: r.rottenTomatoes ?? null,
      metacritic: r.metacritic ?? null,
      tmdbRating: r.tmdbRating ?? null,
      poster: r.poster || null
    };
  }
  debug.unmatched = list.filter((f) => !out[f.key].imdbId).map((f) => f.ratings?.query || f.title);
  screenings.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return {
    listings: {
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      days: Array.from({ length: days }, (_, i) => addDays(today, i)),
      venues: Object.fromEntries(Object.entries(VENUES).map(([id, v]) => [id, v.name])),
      screenings: screenings.map(({ date, time, venue, title, titleEn, year, runtime, ticketUrl, infoUrl, retro, filmKey: filmKey2 }) => ({
        date,
        time,
        venue,
        title,
        titleEn,
        year,
        runtime,
        ticketUrl,
        infoUrl,
        retro,
        filmKey: filmKey2
      })),
      films: out,
      errors
    },
    debug: { ...debug, finishedAt: (/* @__PURE__ */ new Date()).toISOString() }
  };
}

// scripts/actions.mjs
var CACHE_FILE = "data/ratings-cache.json";
var LISTINGS_FILE = "data/listings.json";
await mkdir("data", { recursive: true });
await mkdir("debug", { recursive: true });
var readJson = async (f, fallback) => {
  try {
    return JSON.parse(await readFile(f, "utf8"));
  } catch {
    return fallback;
  }
};
var memo = await readJson(CACHE_FILE, {});
var cache = { get: async (k) => memo[k] ?? null, set: async (k, v) => {
  memo[k] = v;
} };
var previous = await readJson(LISTINGS_FILE, null);
var browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
  defaultViewport: { width: 1280, height: 900 }
});
try {
  const { listings, debug } = await buildListings({ browser, env: process.env, cache });
  const merged = carryOver(listings, previous);
  await writeFile(LISTINGS_FILE, JSON.stringify(merged));
  await writeFile(CACHE_FILE, JSON.stringify(memo));
  for (const [venue, d] of Object.entries(debug.venues)) {
    for (const [i, p] of (d.pages || []).entries()) await writeFile(`debug/${venue}-${i}.html`, p.html);
    d.pages = d.pages?.map((p) => p.label);
  }
  await writeFile("debug/debug.json", JSON.stringify(debug, null, 2));
  console.log("\nScreenings per venue:");
  for (const [venue, d] of Object.entries(debug.venues)) {
    console.log(`  ${venue}: ${d.count ?? 0}${d.error ? `  ERROR ${d.error.split("\n")[0]}` : ""}`);
  }
  if (listings.errors.length) console.log("\nProblems:", JSON.stringify(listings.errors, null, 2));
  if (debug.unmatched.length) console.log(`
No rating match (${debug.unmatched.length}): ${debug.unmatched.join(", ")}`);
} finally {
  await browser.close();
}
function carryOver(next, prev) {
  if (!prev?.screenings) return next;
  const failed = new Set(next.errors.map((e) => e.venue).filter(Boolean));
  for (const venue of failed) {
    if (next.screenings.some((s) => s.venue === venue)) continue;
    for (const s of prev.screenings.filter((x) => x.venue === venue && next.days.includes(x.date))) {
      next.screenings.push({ ...s, stale: true });
      if (prev.films?.[s.filmKey]) next.films[s.filmKey] ??= prev.films[s.filmKey];
    }
  }
  next.screenings.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return next;
}
