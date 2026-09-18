# TLV Screenings

The next 7 days of screenings at the **Tel Aviv Cinematheque**, **Movieland HaTzuk**
and **Jaffa Cinema**, with IMDb / Rotten Tomatoes / Metacritic scores.

- Site: https://avivso.github.io/tlv-screenings/
- Refreshes itself every morning on GitHub Actions (`.github/workflows/refresh.yml`),
  commits `data/`, and deploys to Pages. Nothing runs on anyone's machine.

## Layout

```
scripts/actions.mjs          entry point: scrape, rate, write data/ and debug/
lib/build.mjs                runs each scraper, dedupes films, attaches ratings
lib/ratings.mjs              TMDB search -> IMDb id -> OMDb scores, cached 14 days
lib/overrides.mjs            pin a wrong match by IMDb id
lib/titles.mjs               strip series prefixes/labels off Hebrew titles
lib/util.mjs                 dates, times, fetch with retries, concurrency pool
lib/scrapers/*.mjs           one per venue, plus seret.mjs (a fallback source)
index.html                   the whole site; reads data/listings.json, no build step
```

There is no browser and no Chrome: every venue is reachable with plain `fetch`,
and the one page that needs parsing is handled by `cheerio`.

## Where the data comes from

| Venue | Source |
| --- | --- |
| Cinematheque | `cinema.co.il/shown/?date=YYYY-MM-DD`, server-rendered, one fetch per day |
| Movieland | `movieland.co.il/api/Events` with an empty `Date` returns the whole upcoming schedule in one call |
| Jaffa | the home page links every upcoming `/calendar/<id>/`; each page's `<title>` carries date, time and film. The `/calendar/` index 404s — don't use it. The calendar sitemap is a backstop |

## Known limitation: Movieland cannot be refreshed from Actions

`movieland.co.il` answers GitHub's runners with a Cloudflare "Just a moment"
challenge, because the runner's IP is a datacenter one. So do the Israeli listing
sites that carry the same showtimes (seret.co.il, edb.co.il, screentime.gg), which
is why the seret fallback in `lib/scrapers/seret.mjs` does not rescue it in CI —
it only helps when the refresh runs from an unblocked IP. Request headers make no
difference; this is IP reputation, not user-agent sniffing.

The effect on the site: the Cinematheque and Jaffa refresh normally, and Movieland
shows the last listings that did come through, tagged "from previous refresh",
with a notice. Those carried-over listings age out of the 7-day window over a few
days and Movieland then goes quiet until the run happens from an unblocked IP.

Fixing it properly needs the daily run to come from an IP Cloudflare accepts — an
Israeli VPS, a machine at home on a cron, or a proxy with residential egress. All
of those cost money or ongoing attention, which is why none is wired up.

## Running it locally

```bash
npm install
npm run refresh:local   # needs .env with TMDB_API_KEY and OMDB_API_KEY
npm run preview         # serves the real data/listings.json
```

From a normal Israeli connection all three venues scrape, including Movieland.

## Ratings

`TMDB_API_KEY` and `OMDB_API_KEY` are repository secrets (Settings -> Secrets and
variables -> Actions). Without them the scrape still runs and the page says the
ratings are missing. Films with no match are listed in the run's `debug` artifact
under `unmatched`; pin them in `lib/overrides.mjs` as `"cleaned title": "tt1234567"`.
