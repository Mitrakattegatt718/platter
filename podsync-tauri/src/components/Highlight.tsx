// Marks every occurrence of the search term so it's obvious which part of a
// row matched — the hit is often in the artist or album, not the title.
// Matching runs on the original string via a case-insensitive regex: deriving
// indices from text.toLowerCase() would drift on characters whose lowercase
// form changes length (e.g. İ), mismarking everything after them.
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re: RegExp;
  try {
    re = new RegExp(escaped, "giu");
  } catch {
    return <>{text}</>;
  }
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
