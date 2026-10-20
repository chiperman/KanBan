import type { ReactNode } from "react";

const paths = {
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <><path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5" /></>,
  "arrow-left": <path d="M20 12H4m6-6-6 6 6 6" />,
  "arrow-right": <path d="M4 12h16m-6-6 6 6-6 6" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
  "eye-off": <><path d="m3 3 18 18M10 6.2A12 12 0 0 1 12 6c6.5 0 10 6 10 6a19 19 0 0 1-3 3.5M6.2 6.8A20 20 0 0 0 2 12s3.5 6 10 6a12 12 0 0 0 4.5-.8" /><path d="M10 10a2.8 2.8 0 0 0 4 4" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></>,
  moon: <path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10Z" />,
  computer: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  "panel-left": <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m7-12-3 4 3 4" /></>,
  "panel-right": <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m4-12 3 4-3 4" /></>,
} satisfies Record<string, ReactNode>;

export type VibeIconName = keyof typeof paths;

export function VibeIcon({ name, className = "" }: { name: VibeIconName; className?: string }) {
  return (
    <svg aria-hidden="true" className={`vibe-icon ${className}`} fill="none" focusable="false"
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}
