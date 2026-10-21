// UI-only state shared between components (never synced, never persisted).
import { signal } from "aio/air";
import type { model as M } from "../vendor/pm.js";

export const backstage = signal(false);
export const slideshow = signal(false);
/** Slide the show opens on (Shift+F5 = the one with the caret). */
export const slideFrom = signal(0);
/** Find bar: closed, find only, or find + replace. */
export const findMode = signal<"" | "find" | "replace">("");
/** "3 of 12" style counter for the find bar. */
export const findCount = signal({ cur: 0, total: 0 });
/** Reviewing pane (comments + tracked changes) visible. */
export const reviewPane = signal(false);
/** Options (settings) dialog open. */
export const settingsOpen = signal(false);
/** Format painter: the copied inline marks, and whether it stays on (double-click) until Esc. */
export const painter = signal<{ marks: readonly M.Mark[]; sticky: boolean } | null>(null);
/** Header & footer dialog open. */
export const hfOpen = signal(false);
/** Browser preview: the saved file as a web browser shows it. */
export const previewOpen = signal(false);
