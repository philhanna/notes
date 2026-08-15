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
 * The triangle's bounding box (x 4-12, y 0-8) is square and sits flush
 * with the top of the viewBox. Rotating around its own center (50% 25%
 * of the rendered box, matching that square's midpoint) keeps the ink
 * in the same square footprint in both orientations, so the collapsed
 * (right-pointing) and expanded (down-pointing) glyphs land at the same
 * vertical position — flush with the top of the button that holds it.
 */
export function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      className="tree-row__chevron"
      style={{
        transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
        transformOrigin: "50% 25%",
      }}
    >
      <path d="M4 0 L12 0 L8 8 Z" fill="currentColor" />
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
