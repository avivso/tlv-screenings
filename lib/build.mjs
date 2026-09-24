import { scrapeCinematheque } from "./scrapers/cinematheque.mjs";
import { scrapeMovieland } from "./scrapers/movieland.mjs";
import { scrapeJaffa } from "./scrapers/jaffa.mjs";
import { scrapeAtlas } from "./scrapers/atlas.mjs";
import { scrapePisga } from "./scrapers/pisga.mjs";
import { loadManualVenues, makeManualScraper } from "./scrapers/manual.mjs";
import { getRatings } from "./ratings.mjs";
import { fetchImdbRatings } from "./imdb.mjs";
import { filmKey, isRetroLabel } from "./titles.mjs";
import { ilDate, addDays, pool } from "./util.mjs";

/**
 * `minAge` keeps a venue to its repertory programme: Movieland is a commercial
 * multiplex whose current releases are not what this site is for, so only films
 * at least this many years old are listed for it.
 */
export const MIN_AGE = 3;

export const VENUES = {
  cinematheque: { name: "Cinematheque", scrape: scrapeCinematheque },
  movieland: { name: "Movieland HaTzuk", scrape: scrapeMovieland, minAge: MIN_AGE },
  jaffa: { name: "Jaffa Cinema", scrape: scrapeJaffa },
  atlas: { name: "Rooftop Cinema", scrape: scrapeAtlas },
  pisga: { name: "Cinema HaPisga", scrape: scrapePisga },
};

/**
 * Scrape every venue, attach ratings, and return the listings document the site reads.
 * One venue failing never blocks the others.
 */
export async function buildListings({ env, cache, previous = null, days = 7, log = console.log }) {
  const today = ilDate();
  // Venues that publish only a monthly poster are declared in a JSON file, so
  // adding one is an edit to data, not to code.
  const manual = await loadManualVenues();
  const venues = {
    ...VENUES,
    ...Object.fromEntries(Object.entries(manual).map(([id, v]) => [id, { name: v.name, scrape: makeManualScraper(id, v) }])),
  };
  const debug = { startedAt: new Date().toISOString(), venues: {} };
  const errors = [];
  const screenings = [];

  for (const [id, venue] of Object.entries(venues)) {
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

  // Carry a failed venue's still-upcoming listings over from the last good run,
  // before ratings, so the carried films get looked up like any other.
  const allDays = Array.from({ length: days }, (_, i) => addDays(today, i));
  if (previous?.screenings) {
    for (const venue of new Set(errors.map((e) => e.venue).filter(Boolean))) {
      if (screenings.some((s) => s.venue === venue)) continue;
      const carried = [...previous.screenings, ...(previous.upcoming || [])]
        .filter((s) => s.venue === venue && s.date >= today);
      for (const s of carried) screenings.push({ ...s, stale: true });
      if (carried.length) log(`${venue}: carried ${carried.length} screenings over from the last good run`);
    }
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
    const omdbError = list.find((f) => f.ratings?.omdbError)?.ratings.omdbError;
    if (omdbError) {
      errors.push({
        venue: null,
        message: `OMDb is not answering (${omdbError}), so Rotten Tomatoes and Metacritic scores are missing.`,
      });
    }
  } else {
    errors.push({ venue: null, message: "No TMDB_API_KEY or OMDB_API_KEY set, so ratings are missing." });
  }

  // IMDb's own dump needs no key and is refreshed daily, so it is the source of
  // truth for the IMDb score even when OMDb answered.
  let imdbScores = new Map();
  try {
    imdbScores = await fetchImdbRatings(list.map((f) => f.ratings?.imdbId), { log });
  } catch (e) {
    log(`imdb dataset unavailable: ${e.message}`);
    errors.push({ venue: null, message: `IMDb's ratings dataset is unavailable (${e.message}).` });
  }

  const out = {};
  for (const f of list) {
    const r = f.ratings || {};
    out[f.key] = {
      titleEn: f.titleEn || r.titleEn || null,
      year: f.year || r.year || null,
      imdbId: r.imdbId || null,
      match: r.match || "none",
      imdbRating: imdbScores.get(r.imdbId)?.imdbRating ?? r.imdbRating ?? null,
      imdbVotes: imdbScores.get(r.imdbId)?.imdbVotes ?? r.imdbVotes ?? null,
      rottenTomatoes: r.rottenTomatoes ?? null,
      metacritic: r.metacritic ?? null,
      tmdbRating: r.tmdbRating ?? null,
      poster: r.poster || null,
    };
  }
  debug.unmatched = list.filter((f) => !out[f.key].imdbId).map((f) => f.ratings?.query || f.title);

  // A venue with a minAge contributes only its repertory programme, judged on the
  // year the ratings lookup resolved (a multiplex rarely states one itself).
  const thisYear = Number(today.slice(0, 4));
  const wanted = screenings.filter((s) => {
    const minAge = venues[s.venue]?.minAge;
    if (!minAge) return true;
    const year = out[s.filmKey]?.year ?? s.year;
    return year != null && thisYear - year >= minAge;
  });
  debug.filteredOut = screenings.length - wanted.length;

  const byWhen = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
  const lastDay = allDays[allDays.length - 1];
  const inWeek = wanted.filter((s) => s.date <= lastDay).sort(byWhen);
  // Beyond the week we only list the old stuff — that is what is worth planning for.
  const later = wanted
    .filter((s) => s.date > lastDay)
    .filter((s) => {
      const year = out[s.filmKey]?.year ?? s.year;
      return year != null && thisYear - year >= MIN_AGE;
    })
    .sort(byWhen);

  const strip = ({ date, time, venue, title, titleEn, year, runtime, ticketUrl, infoUrl, retro, filmKey, stale, soldOut }) => ({
    date, time, venue, title, titleEn, year, runtime, ticketUrl, infoUrl, retro, filmKey,
    stale: stale || undefined, soldOut: soldOut || undefined,
  });
  const usedFilms = {};
  for (const s of [...inWeek, ...later]) usedFilms[s.filmKey] ??= out[s.filmKey];

  return {
    listings: {
      generatedAt: new Date().toISOString(),
      days: allDays,
      venues: Object.fromEntries(Object.entries(venues).map(([id, v]) => [id, v.name])),
      screenings: inWeek.map(strip),
      upcoming: later.map(strip),
      minAge: MIN_AGE,
      films: usedFilms,
      errors,
    },
    debug: { ...debug, finishedAt: new Date().toISOString() },
  };
}
