// Inline SVG icons (24×24 stroke icons, currentColor).
import type { JSX } from "aio";

const P: Record<string, string> = {
  textbox: "M3 5h18v14H3zM8 9h8M12 9v7",
  pilcrow: "M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13",
  cut: "M6 6a3 3 0 1 0 0 .01M6 18a3 3 0 1 0 0 .01M8.1 7.9 20 18M8.1 16.1 20 6",
  copy: "M8 8h12v12H8zM4 16V4h12",
  paste: "M9 3h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4",
  grow: "M3 19 8 6l5 13M5 14h6M17 10V4M14 7h6",
  shrink: "M3 19 8 6l5 13M5 14h6M14 7h6",
  up: "m6 15 6-6 6 6",
  resolve: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M8 12l3 3 5-6",
  pane: "M3 4h18v16H3zM15 4v16M17.5 8h1.5M17.5 11h1.5",
  count: "M4 7h3v10M4 17h6M13 7h4a2 2 0 0 1 0 4h-3 3a2 2 0 0 1 0 4h-4",
  user: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c0-4 3.6-6 8-6s8 2 8 6",
  keyboard: "M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10",
  pin: "M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v6",
  down: "m6 9 6 6 6-6",
  brush: "M18 3l3 3-9 9-3-3zM9 12l-3 3c-2 0-3 1.5-3 4 2.5 0 4-1 4-3l3-3",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4",
  replace: "M4 7h12l-3-3M20 17H8l3 3",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  bold: "M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z",
  italic: "M19 4h-9M14 20H5M15 4 9 20",
  underline: "M6 4v6a6 6 0 0 0 12 0V4M4 20h16",
  strike: "M16 4H9a3 3 0 0 0-2.8 4M14 12a4 4 0 0 1 0 8H6M4 12h16",
  sup: "m4 19 8-8M12 19l-8-8M20 12h-4c0-1.5.4-2 1.5-2.5S20 8.3 20 7a2 2 0 0 0-4 0",
  sub: "m4 5 8 8M12 5l-8 8M20 19h-4c0-1.5.4-2 1.5-2.5s2.5-1.2 2.5-2.5a2 2 0 0 0-4 0",
  highlight: "m9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
  color: "M4 20h16M7 16 12 4l5 12M9 11h6",
  eraser: "m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21M22 21H7M5 11l9 9",
  ul: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  ol: "M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",
  task: "m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8",
  outdent: "m7 8-4 4 4 4M21 12H11M21 6H11M21 18H11",
  indent: "m3 8 4 4-4 4M21 12H11M21 6H11M21 18H11",
  left: "M21 6H3M15 12H3M17 18H3",
  center: "M21 6H3M17 12H7M19 18H5",
  right: "M21 6H3M21 12H9M21 18H7",
  justify: "M3 6h18M3 12h18M3 18h18",
  table: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
  image: "M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 21",
  video: "m22 8-6 4 6 4zM2 6h14v12H2z",
  sheet: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18",
  chart: "M3 3v18h18M7 16v-4M12 16V8M17 16v-7",
  rect: "M4 6h16v12H4z",
  ellipse: "M12 19c4.4 0 8-3.1 8-7s-3.6-7-8-7-8 3.1-8 7 3.6 7 8 7",
  roundrect: "M8 5h8a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4",
  arrow: "M4 12h15M14 7l5 5-5 5",
  line: "M5 19 19 5",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  footnote: "M4 7V4h16v3M9 20h6M12 4v16M19 14v6M17 16l2-2",
  sigma: "M18 7V4H6l6 8-6 8h12v-3",
  pagebreak: "M4 4v5h16V4M4 20v-5h16v5M2 12h3M8 12h3M13 12h3M19 12h3",
  hr: "M3 12h18",
  toc: "M3 5h12M3 10h18M7 15h14M7 20h10",
  slide: "M2 4h20v13H2zM8 21h8M12 17v4",
  notes: "M5 3h10l4 4v14H5zM8 10h8M8 14h8M8 18h5",
  code: "m16 18 6-6-6-6M8 6l-6 6 6 6",
  quote: "M3 21c3 0 7-1 7-8V5H3v7h4c0 4-1 5-4 6zM14 21c3 0 7-1 7-8V5h-7v7h4c0 4-1 5-4 6z",
  comment: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  track: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  page: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  rotate: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  margins: "M3 3h18v18H3zM7 7h10v10H7z",
  palette: "M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1 3.7A1.6 1.6 0 0 1 12 22M7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01",
  header: "M4 4h16v6H4zM4 14h16M4 18h10",
  source: "m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16",
  zoomin: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3M11 8v6M8 11h6",
  zoomout: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3M8 11h6",
  play: "m6 3 14 9-14 9z",
  moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  gear:
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  web: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20",
  print: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2M17 21v-8H7v8M7 3v5h8",
  open:
    "m6 14 1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6A2 2 0 0 1 18.5 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2",
  new: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6",
  export: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  merge: "M8 6 4 12l4 6M16 6l4 6-4 6M4 12h16",
  split: "M12 3v18M3 12h6M15 12h6",
  rowadd: "M3 3h18v8H3zM12 15v6M9 18h6",
  coladd: "M3 3h8v18H3zM15 12h6M18 9v6",
  trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  raw: "M4 4h16v16H4zM8 9l-2 3 2 3M16 9l2 3-2 3",
  calc: "M4 2h16v20H4zM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h4",
  attach: "m21.4 11-8.8 8.8a5.6 5.6 0 0 1-8-8l8.8-8.8a3.8 3.8 0 0 1 5.3 5.3l-8.8 8.8a1.9 1.9 0 0 1-2.7-2.7l8.1-8",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 16v-4M12 8h.01",
};

export function Icon(props: { name: string; size?: number }): JSX.Element {
  const s = props.size ?? 18;
  return (
    <svg
      class="jw-icon"
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={P[props.name] ?? P.info} />
    </svg>
  );
}
