// Marks every occurrence of the search term so it's obvious which part of a
// row matched — the hit is often in the artist or album, not the title.
// Matching runs on the original string via a case-insensitive regex: deriving
// indices from text.toLowerCase() would drift on characters whose lowercase
// form changes length (e.g. İ), mismarking everything after them.
/** One compiled regex per query, not per string.
 *
 * Four of these render per track row plus one per header, so a screenful of a
 * filtered list was compiling well over a hundred identical patterns on every
 * render — and again on every scroll frame. The query changes far less often
 * than the rows do. A single slot is all that is needed: every Highlight on
 * screen is showing the same query.
 *
 * `null` is a cached failure — an escaped query should always compile, but if
 * one ever doesn't, the plain-text fallback must not retry it per string. */
let cachedQuery: string | null = null;
let cachedRe: RegExp | null = null;

function queryRegex(query: string): RegExp | null {
  if (query !== cachedQuery) {
    cachedQuery = query;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      cachedRe = new RegExp(escaped, "giu");
    } catch {
      cachedRe = null;
    }
  }
  return cachedRe;
}

export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const re = queryRegex(query);
  if (!re) return <>{text}</>;
  // matchAll needs the shared regex to start from zero each time; /g keeps
  // lastIndex from the previous string otherwise.
  re.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(re)) {
    if (match[0].length === 0) break;
    const start = match.index;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={start}
        className="rounded-sm bg-yellow-400/30 font-semibold text-foreground"
      >
        {match[0]}
      </mark>,
    );
    cursor = start + match[0].length;
  }
  if (parts.length === 0) return <>{text}</>;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
