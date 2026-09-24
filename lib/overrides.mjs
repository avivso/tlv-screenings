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
};
