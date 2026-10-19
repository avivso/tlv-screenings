import { getText } from "../util.mjs";

const LOCATION = 1150; // Lev Tel Aviv, Dizengoff Center
const API = `https://ticket.lev.co.il/api/presentations?locationId=${LOCATION}&includeSynopsis=0`;
export const PAGE = "https://www.lev.co.il/location/telaviv/";

/**
 * Lev Dizengoff sells through pres.global (the same platform as the
 * Cinematheque), whose what's-on page reads this JSON. Each presentation has
 * the Hebrew title, the distributor's English title, the running time and a
 * booking link. Lev is mostly new releases, so build.mjs holds it to films at
 * least MIN_AGE years old, as with Movieland.
 */
export async function scrapeLev(_ctx, { today, dbg, log }) {
  const { presentations = [] } = JSON.parse(await getText(API, { headers: { accept: "application/json" } }));
  dbg.presentations = presentations.length;

  const rows = [];
  for (const p of presentations) {
    const [date, time] = String(p.dateTime || "").split(" ");
    if (!date || !time || date < today || p.private) continue;
    const en = String(p.featureAdditionalName || "").trim();
    rows.push({
      date,
      time: time.slice(0, 5),
      title: String(p.featureName || "").trim(),
      titleEn: en && !/[֐-׿]/.test(en) ? en : null,
      year: null,
      runtime: p.durationInMinutes || null,
      soldOut: p.soldout || undefined,
      ticketUrl: p.newBookingUrl || `https://ticket.lev.co.il/order/${p.id}`,
      infoUrl: PAGE,
    });
  }

  rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  log(`lev: ${rows.length} screenings`);
  return rows;
}
