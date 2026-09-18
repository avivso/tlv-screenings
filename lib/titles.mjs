const SERIES = "MovieRetro|MovieNights|מועדון סרטי איכות|ראשון שיגעון|שלישי בשלייקס|מועדון 60\\+|אפטר בסינמטק|Teen Screen|סינמטק לילדים";

/** Strip series prefixes and screening labels so the film title can be looked up. */
export function cleanTitle(raw) {
  if (!raw) return "";
  let t = String(raw);
  // The site uses "-", "–", ":" or "|" between the series name and the film.
  t = t.replace(new RegExp(`^\\s*(${SERIES})\\s*[-–:|]\\s*`, "i"), "");
  // A trailing " | <series>" names the strand, not the film ("סגל חסר | נבחרי דוקאביב").
  t = t.split(/\s\|\s/)[0];
  t = t.replace(/\((מדובב|מתורגם|כתוביות|אנגלית|עברית|dubbed|subtitled)\)/gi, "");
  t = t.replace(/\s*[-–]\s*(מדובב|מתורגם|כתוביות)(?=\s|$)/g, "");
  t = t.replace(/(^|\s)(בטרום בכורה|טרום בכורה|הקרנת בכורה|הדרן)(?=\s|$)/g, " ");
  t = t.replace(/\s*[-–]\s*חגיגות\s*\d+\s*שנה.*$/, "");
  t = t.replace(/\s*[-–]\s*(\d+)(th)?\s*anniversary.*$/i, "");
  t = t.replace(/\s*[-–]?\s*(3D|4DX|IMAX|VIP)\b/gi, "");
  t = t.replace(/["“”„״'׳]/g, "");
  return t.replace(/\s+/g, " ").trim();
}

/** Series labels that mark a repertory/re-release screening. */
export function isRetroLabel(raw) {
  return /MovieRetro|הדרן|חגיגות\s*\d+\s*שנה|anniversary|קלאסיקה|classic/i.test(String(raw || ""));
}

export function filmKey({ title, titleEn, year }) {
  const base = (titleEn || cleanTitle(title)).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${base}|${year ?? ""}`;
}
