# TLV Screenings

The next 7 days of screenings at the **Tel Aviv Cinematheque**, **Movieland HaTzuk**,
**Jaffa Cinema**, the **Atlas Rooftop Cinema**, **Cinema Migdalor** and **Cinema
HaPisga**, with IMDb scores.

- Site: https://avivso.github.io/tlv-screenings/ — short link: https://da.gd/tlv
- Refreshes itself every morning on GitHub Actions (`.github/workflows/refresh.yml`),
  commits `data/`, and deploys to Pages. Nothing runs on anyone's machine.

## Layout

```
scripts/actions.mjs          entry point: scrape, rate, write data/ and debug/
lib/build.mjs                runs each scraper, dedupes films, attaches ratings
lib/ratings.mjs              TMDB search -> IMDb id, title, year, poster; cached 14 days
lib/imdb.mjs                 IMDb scores from IMDb's own daily dataset, no key
lib/overrides.mjs            pin a wrong match by IMDb id
lib/titles.mjs               strip series prefixes/labels off Hebrew titles
lib/util.mjs                 dates, times, fetch with retries, concurrency pool
lib/scrapers/*.mjs           one per venue; manual.mjs reads data/manual-venues.json
index.html                   the whole site; reads data/listings.json, no build step
```

There is no browser and no Chrome: every venue is reachable with plain `fetch`,
and the one page that needs parsing is handled by `cheerio`.

## Where the data comes from

| Venue | Source |
| --- | --- |
| Cinematheque | `cinema.co.il/shown/?date=YYYY-MM-DD`, server-rendered, one fetch per day |
| Movieland | its ticketing provider's public API (BiggerPicture) — see below |
| Jaffa | the home page links every upcoming `/calendar/<id>/`; each page's `<title>` carries date, time and film. The `/calendar/` index 404s — don't use it. The calendar sitemap is a backstop |
| Rooftop Cinema (Atlas) | `atlas.co.il` is behind a hard Cloudflare block, but the rooftop page is only a shell around a `activity.hotelplus.io` ticketing widget, which serves plain HTML to anyone. Card titles read `<film> | D.M.YY | HH:MM` |
| Cinema Migdalor | `data/manual-venues.json` — see below |
| Cinema HaPisga | BE106's Tel Aviv RSS feed, which reports every screening the Old Jaffa Development Corporation announces; seen screenings are kept in `data/pisga-seen.json` |

## Movieland: through the ticketing API, not the website

`movieland.co.il` answers GitHub's runners with a Cloudflare challenge — as do
seret.co.il, edb.co.il and screentime.gg, which republish its showtimes. Headers
make no difference; it is IP reputation.

Its tickets, though, are sold through BiggerPicture, and BiggerPicture's public
e-commerce API is open to the runners. The storefront starts every visit by
opening an anonymous guest session for the site (`POST /sys/login` with the site
id and sale channel — no account, no credentials), and so does the scraper. Then
`/cus/eventMaster/0/site/1293/startDate/…/endDate/…` returns every screening of
every film; `0` means all films rather than one. The API rejects ranges much past
two months, so it is read in 30-day windows out to 120 days: six requests a day.
Each showtime also carries the distributor's English title, which makes the
ratings match more reliable.

## Running it locally

```bash
npm install
npm run refresh:local   # needs .env with TMDB_API_KEY
npm run preview         # serves the real data/listings.json
```


## What gets listed

The day strip covers the next 7 days. **Movieland is a commercial multiplex**, so
it is filtered to its repertory programme only: films at least `MIN_AGE` (3) years
old, judged on the year the ratings lookup resolved, because the venue rarely
states one. Without that filter it drowns the page in current releases.

Movieland and Jaffa both publish further ahead than a week — Movieland's schedule
runs months out, and its classics are usually in those sparse later dates. Those
screenings are collected too and shown under **Coming up later**, restricted to
films at least 3 years old, since that is what is worth planning around.

## Venues that only post to Instagram

Cinema Migdalor (Migdalor Café, Reading Park) and Cinema HaPisga (Gan HaPisga,
Old Jaffa) both run a **monthly** programme announced as a poster on Instagram or
in a press release, with no feed, no ticketing system and no schedule page.
Instagram hands captions to crawler user-agents and to logged-in browsers and to
nothing else, so there is no honest way to read them from a scheduled job — this
project is not going to impersonate Facebook's crawler once a day to get around it.

They live in `data/manual-venues.json` instead, which is read like any other
source. Adding a venue there is an edit to data, not to code. Each one takes
either of:

- `paste` — the post's caption copied verbatim. Lines shaped like
  `1.9 | שלישי | 20:00 | היומן` (the day name is optional) are read, everything
  else is ignored. `year` says which year those bare dates belong to.
- `screenings` — explicit `{date, time, title}` entries, for programmes announced
  as prose rather than a list.

Once a month, paste the new caption over the old one. Everything downstream —
ratings, posters, English titles, the day strip — then works exactly as it does
for the scraped venues.

## Ratings

- **TMDB** (`TMDB_API_KEY`, a repository secret) identifies each film from its
  Hebrew or English title and supplies the English title, year and poster.
- **IMDb** needs no key: `lib/imdb.mjs` streams IMDb's own daily ratings dump
  (`datasets.imdbws.com`) and picks out the ids we care about. Free for personal,
  non-commercial use. A brand-new film IMDb hasn't rated yet shows TMDB's score.

Films with no match are listed in the run's `debug` artifact under `unmatched`;
pin them in `lib/overrides.mjs` as `"cleaned title": "tt1234567"`. A pin takes
effect on the next run even if a miss is still cached.
