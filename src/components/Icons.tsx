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
export const Board = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <circle cx="7" cy="8.5" r="2.3" />
    <circle cx="12" cy="7" r="2.6" />
    <circle cx="17" cy="8.5" r="2.3" />
    <path d="M3.5 18c.4-3 2-4.6 3.5-4.6M20.5 18c-.4-3-2-4.6-3.5-4.6M7.8 18.5c.4-3.4 2.1-5.2 4.2-5.2s3.8 1.8 4.2 5.2" />
  </svg>
);
export const Frame = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <rect x="3.5" y="5" width="17" height="13" rx="3" />
    <path d="m10.3 9.3 4.2 2.7-4.2 2.7z" />
  </svg>
);
export const Bubbles = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v4a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3H6.5A2.5 2.5 0 0 1 4 10.5z" />
    <path d="M18.5 9.5A2 2 0 0 1 20 11.4v3.6a2 2 0 0 1-2 2h-.5v2.5L14.6 17H12" />
  </svg>
);
export const Checklist = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <rect x="5" y="3.8" width="14" height="17" rx="2.5" />
    <path d="m8.2 9 1.4 1.4L12 8M8.2 14.5l1.4 1.4 2.4-2.4M14 9.5h2.3M14 15h2.3" />
  </svg>
);
export const Play = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M8 5.8v12.4a1 1 0 0 0 1.5.9l9.8-6.2a1 1 0 0 0 0-1.7L9.5 4.9A1 1 0 0 0 8 5.8z" />
  </svg>
);
export const Pause = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M8.5 5.5v13M15.5 5.5v13" />
  </svg>
);
export const Prev = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M6.5 6v12M18 6.5v11a.8.8 0 0 1-1.2.7l-8.3-5.5a.8.8 0 0 1 0-1.4l8.3-5.5a.8.8 0 0 1 1.2.7z" />
  </svg>
);
export const Next = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden {...base}>
    <path d="M17.5 6v12M6 6.5v11a.8.8 0 0 0 1.2.7l8.3-5.5a.8.8 0 0 0 0-1.4L7.2 5.8A.8.8 0 0 0 6 6.5z" />
  </svg>
);
