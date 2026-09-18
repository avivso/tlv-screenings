export const TZ = "Asia/Jerusalem";

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/** Today's date in Israel as YYYY-MM-DD. */
export function ilDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const pad = (n) => String(n).padStart(2, "0");

/**
 * Parse the date formats these sites use: 2026-09-17, 17/09/2026, 17.09.26, 17/09.
 * A day+month with no year gets this year, or next year if it would be >30 days in the past.
 */
export function parseDateLoose(s, todayIso) {
  if (!s) return null;
  s = String(s);
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})(?!\d)/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  m = s.match(/(?<![\d./])(\d{1,2})[./](\d{1,2})(?![\d./])/);
  if (m && todayIso) {
    const y = Number(todayIso.slice(0, 4));
    let iso = `${y}-${pad(m[2])}-${pad(m[1])}`;
    if (iso < addDays(todayIso, -30)) iso = `${y + 1}-${pad(m[2])}-${pad(m[1])}`;
    return iso;
  }
  return null;
}

export function parseTime(s) {
  const m = String(s ?? "").match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  return m ? `${pad(m[1])}:${m[2]}` : null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run fn over items with at most n in flight. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/** fetch with a browser user-agent, a timeout and one retry. */
export async function getText(url, { headers = {}, timeout = 30_000, retries = 2, charset = "utf-8" } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, "accept-language": "he-IL,he;q=0.9,en;q=0.8", ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      if (charset === "utf-8") return await res.text();
      // Older Israeli sites still serve windows-1255.
      return new TextDecoder(charset).decode(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= retries) {
        // "fetch failed" on its own says nothing; keep the underlying cause.
        const cause = e.cause?.code || e.cause?.message;
        throw cause ? new Error(`${e.message} (${cause}) for ${url}`) : e;
      }
      await sleep(1500 * (attempt + 1));
    }
  }
}

export async function getJson(url, opts = {}) {
  return JSON.parse(await getText(url, { headers: { accept: "application/json" }, ...opts }));
}

/** Keep a trimmed copy of a page for debugging a broken scraper. */
export function snapshot(dbg, label, url, html) {
  dbg.pages ??= [];
  dbg.pages.push({ label, url, html: String(html).slice(0, 150_000) });
}
