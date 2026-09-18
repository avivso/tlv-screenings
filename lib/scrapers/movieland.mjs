import { getText, parseTime, addDays, snapshot } from "../util.mjs";
import { scrapeSeretTheater } from "./seret.mjs";

const THEATER = 1293; // HaTzuk Tel Aviv
const SERET_TID = 246; // the same cinema on seret.co.il
export const PAGE = `https://movieland.co.il/theater/${THEATER}`;

/**
 * The theater page is a Vue app, but the list it renders comes from a plain JSON
 * endpoint. Called with an empty Date it returns the whole upcoming schedule for
 * the branch in one request, so no browser and no branch cookie are needed.
 */
export async function scrapeMovieland(_ctx, { today, days, dbg, log }) {
  const url = `https://movieland.co.il/api/Events?TheatreId=${THEATER}&MovieId=&Date=&isHideVODRent=true`;
  let events;
  try {
    const body = await getText(url, {
      headers: { accept: "application/json", "x-requested-with": "XMLHttpRequest", referer: PAGE },
    });
    events = JSON.parse(body);
  } catch (e) {
    // movieland.co.il sits behind Cloudflare, which serves a JS challenge to
    // datacenter IPs. Say so plainly rather than reporting a bare HTTP 403.
    // movieland.co.il sits behind Cloudflare, which serves a JS challenge to
    // datacenter IPs, so on GitHub's runners this is the normal path, not an
    // edge case. seret.co.il lists the same cinema and serves plain HTML.
    dbg.apiError = e.message;
    log(`movieland: own site unavailable (${e.message}); falling back to seret.co.il`);
    const rows = await scrapeSeretTheater(SERET_TID, THEATER, { today, days, dbg, log });
    dbg.source = "seret";
    if (!rows.length) throw new Error(`movieland.co.il refused the request and seret.co.il listed nothing (${e.message})`);
    return rows;
  }
  dbg.source = "movieland";
  dbg.apiUrl = url;
  dbg.filmsReturned = Array.isArray(events) ? events.length : 0;

  if (!Array.isArray(events)) {
    snapshot(dbg, "unexpected api shape", url, JSON.stringify(events).slice(0, 4000));
    throw new Error("api/Events did not return a list");
  }

  const lastDay = addDays(today, days - 1);
  const seen = new Set();
  const rows = [];

  for (const ev of events) {
    const title = String(ev.Name ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const runtime = Number(ev.LengthInMinutes) || null;
    const year = Number(ev.ReleaseYear) || null;

    for (const d of ev.Dates ?? []) {
      // "2026-09-19T19:15:00" carries both halves; Hour is the fallback.
      const stamp = String(d.Date ?? "");
      const date = (stamp.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
      const time = parseTime(stamp.slice(10)) ?? parseTime(d.Hour);
      if (!date || !time || date < today || date > lastDay) continue;

      const key = d.EventId ? `id:${d.EventId}` : `${title}|${date}|${time}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        date, time, title, titleEn: null, year, runtime,
        ticketUrl: d.BookingNativeUrl || PAGE,
        infoUrl: PAGE,
      });
    }
  }

  log(`movieland: ${rows.length} screenings from ${events.length} films`);
  return rows;
}
