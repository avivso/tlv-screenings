// Temporary: can a GitHub runner reach the two new venues' data?
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
for (const url of [
  "https://www.tamuseum.org.il/api/v2/he/events/filter/?category=film&offset=0",
  "https://ticket.lev.co.il/api/presentations?locationId=1150&includeSynopsis=0",
]) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(25000) });
    const b = await r.text();
    console.log(r.status, r.headers.get("server"), b.length, url.split("/")[2], b.slice(0, 70).replace(/\s+/g, " "));
  } catch (e) { console.log("FAIL", url, e.message); }
}
