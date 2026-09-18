// Temporary: probe how the venue sites respond from a GitHub runner.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const rich = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "he-IL,he;q=0.9,en;q=0.8",
  "accept-encoding": "gzip, deflate, br",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};
const targets = [
  ["movieland home", "https://movieland.co.il/theater/1293", {}],
  ["movieland api  ", "https://movieland.co.il/api/Events?TheatreId=1293&MovieId=&Date=&isHideVODRent=true", { accept: "application/json", "x-requested-with": "XMLHttpRequest", referer: "https://movieland.co.il/theater/1293" }],
  ["jaffa home    ", "https://www.jaffacinema.com/", {}],
  ["jaffa sitemap ", "https://www.jaffacinema.com/calendar-sitemap.xml", {}],
  ["jaffa event   ", "https://www.jaffacinema.com/calendar/8708/", {}],
  ["cinematheque  ", "https://www.cinema.co.il/shown/?date=2026-09-19", {}],
];
for (const [label, url, extra] of targets) {
  for (const [mode, headers] of [["plain-UA", { "user-agent": UA, ...extra }], ["rich", { ...rich, ...extra }]]) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(25_000), redirect: "follow" });
      const body = await res.text();
      console.log(`${label} ${mode.padEnd(8)} ${res.status} ${String(body.length).padStart(7)}b ${Date.now() - t0}ms  server=${res.headers.get("server")} cf=${res.headers.get("cf-ray") ? "yes" : "no"}  ${body.slice(0, 90).replace(/\s+/g, " ")}`);
    } catch (e) {
      console.log(`${label} ${mode.padEnd(8)} FAIL ${Date.now() - t0}ms  ${e.name}: ${e.message} ${e.cause?.code || e.cause?.message || ""}`);
    }
  }
}
console.log("runner egress IP:", await fetch("https://api.ipify.org?format=json").then((r) => r.json()).then((j) => j.ip).catch(() => "?"));
