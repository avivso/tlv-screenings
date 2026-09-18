import { scrapeCinematheque } from "./scrapers/cinematheque.mjs";
import { scrapeMovieland } from "./scrapers/movieland.mjs";
import { scrapeJaffa } from "./scrapers/jaffa.mjs";
import { getRatings } from "./ratings.mjs";
import { filmKey, isRetroLabel } from "./titles.mjs";
import { ilDate, addDays, pool } from "./util.mjs";

export const VENUES = {
  cinematheque: { name: "Cinematheque", scrape: scrapeCinematheque },
  movieland: { name: "Movieland HaTzuk", scrape: scrapeMovieland },
  jaffa: { name: "Jaffa Cinema", scrape: scrapeJaffa },
};

/**
 * Scrape every venue, attach ratings, and return the listings document the site reads.
 * One venue failing never blocks the others.
 */
export async function buildListings({ env, cache, days = 7, log = console.log }) {
  const today = ilDate();
  const debug = { startedAt: new Date().toISOString(), venues: {} };
  const errors = [];
  const screenings = [];

  for (const [id, venue] of Object.entries(VENUES)) {
    const dbg = (debug.venues[id] = {});
    const t0 = Date.now();
    try {
      const rows = await venue.scrape(null, { today, days, dbg, log });
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

  // One ratings lookup per distinct film.
  const films = {};
  for (const s of screenings) {
    s.retro = isRetroLabel(s.title);
    s.filmKey = filmKey(s);
    films[s.filmKey] ??= { key: s.filmKey, title: s.title, titleEn: s.titleEn, year: s.year, retro: s.retro };
  }
  const list = Object.values(films);
  if (env.OMDB_API_KEY || env.TMDB_API_KEY) {
    await pool(list, 4, async (f) => {
      f.ratings = await getRatings(f, { env, cache, log });
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
      poster: r.poster || null,
    };
  }
  debug.unmatched = list.filter((f) => !out[f.key].imdbId).map((f) => f.ratings?.query || f.title);

  screenings.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return {
    listings: {
      generatedAt: new Date().toISOString(),
      days: Array.from({ length: days }, (_, i) => addDays(today, i)),
      venues: Object.fromEntries(Object.entries(VENUES).map(([id, v]) => [id, v.name])),
      screenings: screenings.map(({ date, time, venue, title, titleEn, year, runtime, ticketUrl, infoUrl, retro, filmKey }) => ({
        date, time, venue, title, titleEn, year, runtime, ticketUrl, infoUrl, retro, filmKey,
      })),
      films: out,
      errors,
    },
    debug: { ...debug, finishedAt: new Date().toISOString() },
  };
}
