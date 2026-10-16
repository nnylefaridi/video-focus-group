/* Small hand-tuned line icons. Rounded caps, 1.75 stroke, drawn for this app. */
type P = { className?: string };
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const ArrowUp = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M12 19V6" />
    <path d="M6.5 11.2 12 5.5l5.5 5.7" />
  </svg>
);
export const ArrowLeft = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M19 12H6" />
    <path d="M11.2 6.5 5.5 12l5.7 5.5" />
  </svg>
);
export const Plus = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M12 6v12M6 12h12" />
  </svg>
);
export const Close = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
);
export const Pencil = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M14.5 5.5l4 4L9 19l-4.5 1 1-4.5z" />
  </svg>
);
export const Film = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <rect x="5" y="3.5" width="14" height="17" rx="3" />
    <path d="M5 8h2.5M5 12h2.5M5 16h2.5M16.5 8H19M16.5 12H19M16.5 16H19" />
    <path d="m10.5 9.8 3.5 2.2-3.5 2.2z" />
  </svg>
);
export const Spinner = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={`${className ?? ""} animate-spin`} aria-hidden {...base}>
    <path d="M12 4a8 8 0 1 1-8 8" />
  </svg>
);
export const Eye = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);
export const Book = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z" />
    <path d="M5 20.5A2.5 2.5 0 0 0 7.5 23H19" transform="translate(0 -2)" />
  </svg>
);
