export function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="11"
        cy="11"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        x1="21"
        y1="21"
        x2="16.65"
        y2="16.65"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The triangle fills its whole 12x12 viewBox and is square, so rotating
 * it about the box's own center (the default transform-origin) keeps
 * the same footprint in both orientations. `.tree-row__line` aligns its
 * grid items by text baseline (index.css) rather than a hardcoded pixel
 * offset, since where a font's glyph "ink" sits relative to its own
 * line box varies across platforms — baseline is the one reference
 * browsers compute consistently from the actual font metrics in use.
 */
export function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      className="tree-row__chevron"
      style={{
        transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
      }}
    >
      <path d="M0 0 L12 0 L6 12 Z" fill="currentColor" />
    </svg>
  );
}

export function SignOutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="16 17 21 12 16 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="21"
        y1="12"
        x2="9"
        y2="12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
