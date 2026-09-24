// Temporary: can a GitHub runner reach Movieland's ticketing API?
const B = "https://pub-api-use1.biggerpicture.ai/ecomAPI/public/api";
const t0 = Date.now();
const login = await fetch(`${B}/sys/login`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ siteId: 1293, saleChannelCode: "web", language: "he_IL" }),
});
const lbody = await login.text();
console.log("login", login.status, login.headers.get("server"), lbody.slice(0, 80).replace(/\s+/g, " "));
let token = null; try { token = JSON.parse(lbody).token; } catch {}
if (token) {
  for (const p of ["/cus/event/code/1293-23306", "/cus/eventMaster/1310/site/1293/startDate/2026-09-24/endDate/2026-10-31"]) {
    const r = await fetch(B + p, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    const b = await r.text();
    console.log(p, r.status, b.length, b.slice(0, 120).replace(/\s+/g, " "));
  }
}
console.log("ms", Date.now() - t0);
