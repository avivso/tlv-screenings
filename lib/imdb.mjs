import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { UA } from "./util.mjs";

const DATASET = "https://datasets.imdbws.com/title.ratings.tsv.gz";

/**
 * IMDb publishes its own ratings as a daily TSV dump, with no key and no rate
 * limit, so the IMDb half of a film's scores does not depend on OMDb. The file
 * is ~1.5M rows; we stream it and stop as soon as every id we care about is
 * found. Free for personal, non-commercial use, which is what this is.
 */
export async function fetchImdbRatings(ids, { log = () => {} } = {}) {
  const want = new Set([...ids].filter(Boolean));
  const found = new Map();
  if (!want.size) return found;

  const res = await fetch(DATASET, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${DATASET}`);

  const gunzip = createGunzip();
  const lines = createInterface({ input: Readable.fromWeb(res.body).pipe(gunzip) });
  try {
    for await (const line of lines) {
      const end = line.indexOf("\t");
      if (end < 0 || !want.has(line.slice(0, end))) continue;
      const [id, rating, votes] = line.split("\t");
      found.set(id, { imdbRating: Number(rating) || null, imdbVotes: Number(votes) || null });
      if (found.size === want.size) break;
    }
  } finally {
    lines.close();
    gunzip.destroy();
  }

  log(`imdb dataset: ${found.size} of ${want.size} ids found`);
  return found;
}
