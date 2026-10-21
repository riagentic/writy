// User preferences + recent files. Small, persisted, shared by every window.
import { cell } from "aio";

export type Recent = { path: string; name: string; at: number };
export type State = {
  recent: Recent[];
  author: string;
  dark: "auto" | "light" | "dark";
  zoom: number;
  showSource: boolean;
  /** Editor view only (never the saved file — that is the document's `display`). */
  layout: "print" | "web";
  lastDir: string;
  /** Navigation pane (headings outline) visible. */
  nav: boolean;
  /** Ribbon collapsed to its tab row (Ctrl+F1). */
  ribbonMin: boolean;
  /** Pinned recent files (paths). */
  pinned: string[];
  /** Recently used font / highlight colours (hex, newest first). */
  colors: string[];
};

const DEFAULTS: State = {
  recent: [],
  author: "",
  dark: "auto",
  zoom: 100,
  showSource: false,
  layout: "print",
  lastDir: "",
  nav: false,
  ribbonMin: false,
  pinned: [],
  colors: [],
};
const THEMES = ["auto", "light", "dark"] as const;
const PICKS = ["open", "picture", "video", "any", "folder"] as const;
export type Pick = typeof PICKS[number];

export const prefs = cell("prefs", {
  version: 8, // 6: dropped `paper` — a page always shows its own colours; 8: dropped `desk` — the workspace colour is a document setting
  onMigrate: (s) => {
    const { paper: _, desk: _d, ...rest } = s as Partial<State> & { paper?: unknown; desk?: unknown };
    return { ...DEFAULTS, ...rest };
  },
  state: DEFAULTS,
  args: {
    addRecent: [(v) => typeof v === "string" && v !== "" || "path required", null, null],
    useColor: [(v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) || "hex colour required"],
    pick: [(v) => PICKS.includes(v as Pick) || `one of ${PICKS.join(", ")}`],
    setZoom: [(v) => typeof v === "number" && v >= 25 && v <= 400 || "zoom 25–400"],
  },
  methods: {
    addRecent(s, path: string, name: string, at: number) {
      const all = [{ path, name, at }, ...s.recent.filter((r) => r.path !== path)];
      let free = 12; // pinned files never fall off the list
      s.recent = all.filter((r) => s.pinned.includes(r.path) || free-- > 0);
      s.lastDir = path.replace(/[\\/][^\\/]*$/, "");
    },
    forget(s, path: string) {
      s.recent = s.recent.filter((r) => r.path !== path);
      s.pinned = s.pinned.filter((p) => p !== path);
    },
    togglePin(s, path: string) {
      s.pinned = s.pinned.includes(path) ? s.pinned.filter((p) => p !== path) : [...s.pinned, path];
    },
    useColor(s, hex: string) {
      s.colors = [hex.toLowerCase(), ...s.colors.filter((c) => c !== hex.toLowerCase())].slice(0, 10);
    },
    setAuthor(s, name: string) {
      s.author = name.trim();
    },
    setDark(s, mode: "auto" | "light" | "dark") {
      s.dark = mode;
    },
    /** System → Light → Dark → System (the status-bar toggle). */
    cycleTheme(s) {
      s.dark = THEMES[(THEMES.indexOf(s.dark) + 1) % THEMES.length];
    },
    toggleNav(s) {
      s.nav = !s.nav;
    },
    toggleRibbon(s) {
      s.ribbonMin = !s.ribbonMin;
    },
    setZoom(s, zoom: number) {
      s.zoom = Math.round(zoom);
    },
    toggleSource(s) {
      s.showSource = !s.showSource;
    },
    setLayout(s, layout: "print" | "web") {
      s.layout = layout;
    },
    /** Native file dialog, starting in the last folder. A method, not a serverFn: the dialog lifts the call ceiling while a
     *  person decides — a serverFn call gives up after 30 s and the pick is lost. */
    async pick(s, kind: Pick): Promise<string | null> {
      const dir = s.lastDir || undefined;
      return (await import("../server/pick.server.ts")).pick(kind, dir);
    },
  },
});
