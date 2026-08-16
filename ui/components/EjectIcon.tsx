/** The eject mark: a triangle over a rule, the way every disk UI on this
 * platform draws it.
 *
 * Its own file because two places draw it — the header, where it is a standing
 * button beside the capacity gauge, and the drive menu, where it appears over
 * a row's free-space figure under the pointer. Lucide has no eject glyph, so
 * the alternative was two hand-written copies drifting apart. */
export function EjectIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M5 13 L12 5 L19 13 Z" strokeLinejoin="round" />
      <line x1="5" y1="18" x2="19" y2="18" strokeLinecap="round" />
    </svg>
  );
}
