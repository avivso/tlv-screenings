import overrides from "./overrides.mjs";
import { cleanTitle } from "./titles.mjs";

const TMDB = "https://api.themoviedb.org/3";
const OMDB = "https://www.omdbapi.com/";
const HIT_TTL = 14 * 864e5;
const MISS_TTL = 3 * 864e5;

/**
 * Find a film's IMDb id (TMDB search handles Hebrew titles), then read IMDb,
 * Rotten Tomatoes and Metacritic scores from OMDb. Results are cached.
 */
export async function getRatings(film, { env, cache, log = () => {} }) {
  const cacheKey = `film:${film.key}`;
  const cached = await cache.get(cacheKey);
  // A newly added override must take effect now, not once the cache expires.
  const pinned = overrides[cleanTitle(film.title)] || (film.titleEn && overrides[film.titleEn]);
  const stalePin = pinned && cached?.data.imdbId !== pinned;
  if (cached && !stalePin) {
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
  await cache.set(cacheKey, { fetchedAt: Date.now(), data });
  return data;
}

function emptyRatings(film) {
  return { query: cleanTitle(film.title), imdbId: null, match: "none" };
}

async function lookup(film, env) {
  const clean = cleanTitle(film.title);
  const result = { query: clean, imdbId: null, match: "none" };

  const override = overrides[clean] || (film.titleEn && overrides[film.titleEn]);
  if (override) {
    result.imdbId = override;
    result.match = "override";
  }

  // An override fixes the identity, not the metadata: ask TMDB for the rest.
  if (result.imdbId && env.TMDB_API_KEY) {
    const found = await getJson(`${TMDB}/find/${result.imdbId}?api_key=${env.TMDB_API_KEY}&external_source=imdb_id`);
    const hit = found?.movie_results?.[0];
    if (hit) {
      Object.assign(result, {
        titleEn: hit.title,
        year: hit.release_date ? Number(hit.release_date.slice(0, 4)) : null,
        tmdbRating: hit.vote_count >= 20 ? round1(hit.vote_average) : null,
        poster: hit.poster_path ? `https://image.tmdb.org/t/p/w185${hit.poster_path}` : null,
      });
    }
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
        poster: det?.poster_path ? `https://image.tmdb.org/t/p/w185${det.poster_path}` : null,
      });
    }
  }

  if (!result.imdbId && env.OMDB_API_KEY && film.titleEn) {
    const o = await omdb(`${OMDB}?apikey=${env.OMDB_API_KEY}&type=movie&t=${encodeURIComponent(film.titleEn)}${film.year ? `&y=${film.year}` : ""}`, result);
    if (o?.Response === "True") Object.assign(result, { imdbId: o.imdbID, match: "fuzzy" });
  }

  if (result.imdbId && env.OMDB_API_KEY) {
    const o = await omdb(`${OMDB}?apikey=${env.OMDB_API_KEY}&i=${result.imdbId}`, result);
    if (o?.Response === "True") {
      const rt = o.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value;
      Object.assign(result, {
        titleEn: result.titleEn || o.Title,
        year: result.year || Number(String(o.Year).slice(0, 4)) || null,
        imdbRating: num(o.imdbRating),
        imdbVotes: num(String(o.imdbVotes || "").replace(/,/g, "")),
        rottenTomatoes: rt ? num(rt.replace("%", "")) : null,
        metacritic: num(o.Metascore),
        poster: result.poster || (o.Poster && o.Poster !== "N/A" ? o.Poster : null),
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
  const thisYear = new Date().getFullYear();
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

/**
 * OMDb is the optional half of a lookup: it adds the IMDb, Rotten Tomatoes and
 * Metacritic scores. If the key is missing or rejected we still want to keep
 * what TMDB found (English title, year, poster, TMDB rating), so a failure here
 * is recorded on the result rather than thrown.
 */
async function omdb(url, result) {
  try {
    const o = await getJson(url);
    if (o?.Response === "False" && /api key/i.test(o.Error || "")) {
      result.omdbError = o.Error;
      return null;
    }
    return o;
  } catch (e) {
    result.omdbError = e.message;
    return null;
  }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401) throw new Error(`API key rejected by ${new URL(url).host}`);
  if (!res.ok) return null;
  return res.json();
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== "N/A" && v !== "" ? n : null;
};
const round1 = (n) => Math.round(n * 10) / 10;
