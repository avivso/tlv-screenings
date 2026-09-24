import { getText, addDays, sleep } from "../util.mjs";

const SITE = 1293; // Movieland HaTzuk Tel Aviv
const API = "https://pub-api-use1.biggerpicture.ai/ecomAPI/public/api";
export const PAGE = `https://movieland.co.il/theater/${SITE}`;
const HORIZON = 120; // its repertory screenings are often months out
const WINDOW = 30; // the API refuses ranges much past two months

/**
 * movieland.co.il answers GitHub's runners with a Cloudflare challenge, but its
 * tickets are sold through BiggerPicture, whose public e-commerce API is open
 * to them. The storefront starts every visit the same way: an anonymous guest
 * session for the site (no account, no credentials), then reads the schedule.
 * `eventMaster/0` asks for every film at once instead of one film at a time.
 */
export async function scrapeMovieland(_ctx, { today, dbg, log }) {
  const token = await guestSession();

  const byId = new Map();
  for (let from = 0; from < HORIZON; from += WINDOW) {
    const start = addDays(today, from);
    const end = addDays(today, Math.min(from + WINDOW, HORIZON));
    const body = await getText(`${API}/cus/eventMaster/0/site/${SITE}/startDate/${start}/endDate/${end}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    for (const ev of JSON.parse(body).list || []) byId.set(ev.eventId, ev);
    await sleep(300);
  }
  dbg.eventsReturned = byId.size;

  const rows = [];
  for (const ev of byId.values()) {
    if (ev.isActive === false) continue;
    const [date, clock] = String(ev.dateTimeOfEvent || "").split("T");
    const time = clock?.slice(0, 5);
    if (!date || !time || date < today) continue;
    rows.push({
      date,
      time,
      title: String(ev.eventMasterName || ev.eventMasterDisplayName || "").replace(/\s+/g, " ").trim(),
      titleEn: englishTitle(ev.originalName),
      year: null,
      runtime: ev.lengthInMinutes || null,
      ticketUrl: `https://ecom.biggerpicture.ai/site/${SITE}?code=${SITE}-${ev.eventId}&saleChannelCode=web&languageid=he_IL`,
      infoUrl: PAGE,
    });
  }

  rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  log(`movieland: ${rows.length} screenings from ${new Set(rows.map((r) => r.title)).size} films`);
  return rows;
}

async function guestSession() {
  const res = await fetch(`${API}/sys/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ siteId: SITE, saleChannelCode: "web", language: "he_IL" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`BiggerPicture guest session refused (HTTP ${res.status})`);
  const { token } = await res.json();
  if (!token) throw new Error("BiggerPicture guest session returned no token");
  return token;
}

/**
 * `originalName` is the distributor's English title when there is one, and a
 * copy of the Hebrew name when there isn't. Screening labels ("Encore",
 * "25th Anniversary") are dropped so the ratings lookup finds the film itself.
 */
function englishTitle(raw) {
  const t = String(raw || "")
    .replace(/^[\s|]+/, "")
    .replace(/\s+encore\s*$/i, "")
    .replace(/\s+\d+(st|nd|rd|th)\s+anniversary\s*$/i, "")
    .trim();
  if (!t || /[֐-׿]/.test(t)) return null;
  return t;
}
