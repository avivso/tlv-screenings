/**
 * Refresh entry point for GitHub Actions.
 * Scrapes all venues, adds ratings, and writes data/listings.json for the page.
 */
import dns from "node:dns";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// GitHub runners advertise IPv6 but cannot always reach these hosts over it,
// which surfaces as an unexplained "fetch failed".
dns.setDefaultResultOrder("ipv4first");
import { buildListings } from "../lib/build.mjs";

const CACHE_FILE = "data/ratings-cache.json";
const LISTINGS_FILE = "data/listings.json";
await mkdir("data", { recursive: true });
await mkdir("debug", { recursive: true });

const readJson = async (f, fallback) => {
  try { return JSON.parse(await readFile(f, "utf8")); } catch { return fallback; }
};

const memo = await readJson(CACHE_FILE, {});
const cache = { get: async (k) => memo[k] ?? null, set: async (k, v) => { memo[k] = v; } };
const previous = await readJson(LISTINGS_FILE, null);

const { listings, debug } = await buildListings({ env: process.env, cache });
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
if (debug.unmatched.length) console.log(`\nNo rating match (${debug.unmatched.length}): ${debug.unmatched.join(", ")}`);

/** If a venue failed today, keep its still-upcoming listings from the last good run. */
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
