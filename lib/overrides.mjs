/**
 * Fix wrong or missing rating matches by hand.
 * Key: the cleaned title as listed in debug/debug.json under "unmatched" (or any
 * title the site prints). Value: the IMDb id from the film's IMDb URL.
 *
 * Example:
 *   "האודיסאה": "tt33764258",
 */
export default {
  // A 25th-anniversary screening of the 2001 original, which TMDB answers with Fast X.
  "מהיר ועצבני": "tt0232500",
  // The geresh is stripped before lookup, leaving "סנאצ", which TMDB doesn't know.
  "סנאצ": "tt0208092",
  // Jaffa SYNC festival, Gan HaPisga: silent films with live scores.
  "ברלין: סימפוניה של עיר גדולה": "tt0017668", // Berlin: Symphony of a Metropolis, 1927
  "נכשלתי, אבל…": "tt0023634", // Ozu, I Was Born, But..., 1932
  // Tel Aviv Museum of Art, Americana weekend.
  "מדיום קול": "tt0064652", // Medium Cool, 1969
  "מד מן": "tt0804503", // Mad Men — pinned so it is recognised as TV and left off the site
};
