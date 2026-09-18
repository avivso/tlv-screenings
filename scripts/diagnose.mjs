const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const rich = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "he-IL,he;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin",
  "upgrade-insecure-requests": "1",
  referer: "https://www.seret.co.il/",
};
const targets = [
  ["seret theater ", "https://www.seret.co.il/movies/s_theatres.asp?TID=246"],
  ["seret mobile  ", "https://m.seret.co.il/s_theatres.asp?TID=246"],
  ["seret nrg     ", "https://nrg.seret.co.il/nrg/s_theatres.asp?TID=246"],
  ["seret home    ", "https://www.seret.co.il/"],
  ["edb theater   ", "https://www.edb.co.il/showtimes/theater/106/"],
  ["screentime    ", "https://screentime.gg/location/ml1293"],
];
for (const [label, url] of targets) {
  for (const [mode, headers] of [["bare", {}], ["plain-UA", { "user-agent": UA }], ["rich", rich]]) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(25_000), redirect: "follow" });
      const b = await res.text();
      console.log(`${label} ${mode.padEnd(8)} ${res.status} ${String(b.length).padStart(7)}b server=${res.headers.get("server")} ${b.slice(0, 70).replace(/\s+/g, " ")}`);
    } catch (e) {
      console.log(`${label} ${mode.padEnd(8)} FAIL ${e.name}: ${e.message}`);
    }
  }
}
