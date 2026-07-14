import type { Path } from "../domain/types.ts";

interface BreadcrumbsProps {
  path: Path;
  onNavigate: (path: Path) => void;
}

/** Breadcrumb navigation for the current object or array (design.md 6.1). */
export function Breadcrumbs({ path, onNavigate }: BreadcrumbsProps) {
  const segments: { label: string; target: Path }[] = [
    { label: "Notes", target: [] },
    ...path.map((segment, index) => ({
      label: String(segment),
      target: path.slice(0, index + 1),
    })),
  ];

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        {segments.map((segment, index) => {
          const isCurrent = index === segments.length - 1;
          return (
            <li key={index}>
              {isCurrent ? (
                <span aria-current="location">{segment.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(segment.target)}
                >
                  {segment.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
