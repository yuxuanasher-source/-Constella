"use client";
import React from "react";

// Inline stroke-icons — 16/18/20 sizing. All paths from scratch (simple geometry).
const ic = (props, paths) => {
  const {
    size = 16,
    stroke = "currentColor",
    sw = 1.6,
    fill = "none",
    ...rest
  } = props || {};
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {paths}
    </svg>
  );
};

const Icon = {
  Dashboard: (p) =>
    ic(
      p,
      <>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </>,
    ),
  Project: (p) =>
    ic(
      p,
      <>
        <path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </>,
    ),
  Streamer: (p) =>
    ic(
      p,
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 20c1.2-3.5 4.2-5.5 7.5-5.5s6.3 2 7.5 5.5" />
      </>,
    ),
  Audit: (p) =>
    ic(
      p,
      <>
        <path d="M6 3.5h9l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11.5A1.5 1.5 0 0 1 4.5 20V5a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M14.5 3.5v4.5H19" />
        <path d="M8 12.5h8M8 16h6" />
      </>,
    ),
  Tasks: (p) =>
    ic(
      p,
      <>
        <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
        <path d="M3.5 9h17" />
        <path d="M8 4.5v3M16 4.5v3" />
        <path d="M7.5 13.5l2 2 4-4" />
      </>,
    ),
  Reports: (p) =>
    ic(
      p,
      <>
        <path d="M4 19V5a1.5 1.5 0 0 1 1.5-1.5H15l5 5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19Z" />
        <path d="M14.5 3.5v5H20" />
        <path d="M8 12h6M8 16h8" />
      </>,
    ),
  Money: (p) =>
    ic(
      p,
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <circle cx="12" cy="12.5" r="2.5" />
        <path d="M6 9.5V9M18 16v.5" />
      </>,
    ),
  Export: (p) =>
    ic(
      p,
      <>
        <path d="M12 4v11" />
        <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
        <path d="M4.5 17v1.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V17" />
      </>,
    ),
  Bell: (p) =>
    ic(
      p,
      <>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </>,
    ),
  Search: (p) =>
    ic(
      p,
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m20 20-3.5-3.5" />
      </>,
    ),
  ChevDown: (p) => ic(p, <path d="m6 9 6 6 6-6" />),
  ChevRight: (p) => ic(p, <path d="m9 6 6 6-6 6" />),
  ChevLeft: (p) => ic(p, <path d="m15 6-6 6 6 6" />),
  Plus: (p) =>
    ic(
      p,
      <>
        <path d="M12 5v14M5 12h14" />
      </>,
    ),
  More: (p) =>
    ic(
      p,
      <>
        <circle cx="6" cy="12" r="1.2" />
        <circle cx="12" cy="12" r="1.2" />
        <circle cx="18" cy="12" r="1.2" />
      </>,
    ),
  Filter: (p) => ic(p, <path d="M4 5h16l-6 8v6l-4-2v-4z" />),
  Settings: (p) =>
    ic(
      p,
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 14.5 21 15.2l-1 2-1.7-.4a7.5 7.5 0 0 1-1.5.9l-.3 1.8h-2.4l-.3-1.8a7.5 7.5 0 0 1-1.5-.9l-1.7.4-1-2 1.6-.7a7.5 7.5 0 0 1 0-1.8L4.6 12 5.6 10l1.7.4a7.5 7.5 0 0 1 1.5-.9l.3-1.8h2.4l.3 1.8a7.5 7.5 0 0 1 1.5.9l1.7-.4 1 2-1.6.7a7.5 7.5 0 0 1 0 1.8z" />
      </>,
    ),
  Sparkles: (p) =>
    ic(
      p,
      <>
        <path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
        <path d="m19 16 .8 1.7L21.5 18l-1.7.3L19 20l-.3-1.7L17 18l1.7-.3z" />
      </>,
    ),
  Calendar: (p) =>
    ic(
      p,
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
        <path d="M3.5 10h17M8 3.5v3.5M16 3.5v3.5" />
      </>,
    ),
  Check: (p) => ic(p, <path d="m5 12 4.5 4.5L19 7" />),
  X: (p) => ic(p, <path d="m6 6 12 12M18 6 6 18" />),
  Eye: (p) =>
    ic(
      p,
      <>
        <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>,
    ),
  Play: (p) => ic(p, <path d="M7 5.5v13l11-6.5z" />),
  Pause: (p) =>
    ic(
      p,
      <>
        <rect x="7" y="5" width="3.5" height="14" rx="1" />
        <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
      </>,
    ),
  Upload: (p) =>
    ic(
      p,
      <>
        <path d="M12 16V5" />
        <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
        <path d="M4.5 17v1.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V17" />
      </>,
    ),
  Warn: (p) =>
    ic(
      p,
      <>
        <path d="M12 3.5 21 19H3z" />
        <path d="M12 10v4M12 17v.01" />
      </>,
    ),
  Lock: (p) =>
    ic(
      p,
      <>
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>,
    ),
  Unlock: (p) =>
    ic(
      p,
      <>
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V8a4 4 0 0 1 7.7-1.4" />
      </>,
    ),
  Trend: (p) =>
    ic(
      p,
      <>
        <path d="M4 16.5 9 11l3.5 3.5L20 6.5" />
        <path d="M15 6.5h5v5" />
      </>,
    ),
  Game: (p) =>
    ic(
      p,
      <>
        <rect x="2.5" y="7" width="19" height="10" rx="4" />
        <path d="M7 11v2M5.5 12h3M14 12h.01M16.5 13.5h.01M16.5 10.5h.01M18 12h.01" />
      </>,
    ),
  Logo: (p) =>
    ic(
      { ...p, sw: 0, fill: "currentColor" },
      <>
        <path
          d="M4 6.5c0-1.2.9-2 2-2h8c4.5 0 7.5 3 7.5 7.5S18.5 19.5 14 19.5H6c-1.2 0-2-.8-2-2z"
          opacity=".18"
        />
        <path d="M8 9.5h4a3 3 0 1 1 0 6H8z" />
      </>,
    ),
  History: (p) =>
    ic(
      p,
      <>
        <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
        <path d="M3.5 4v4h4" />
        <path d="M12 8v4l3 2" />
      </>,
    ),
  Pencil: (p) =>
    ic(
      p,
      <>
        <path d="m4 20 1-4L16 5l3 3L8 19z" />
        <path d="m13 8 3 3" />
      </>,
    ),
};

export { Icon };
