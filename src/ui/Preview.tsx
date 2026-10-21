// Browser preview: the exact file Save would write, shown in a sandboxed frame — what a web browser shows when the file is opened.
import type { JSX } from "aio";
import { onCleanup, onMount, useLocal, useRef } from "aio/air";
import { Icon } from "./icons.tsx";
import { fileDisplay, fileHtml } from "../editor/session.ts";
import { previewOpen } from "./state.ts";

const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
/** Esc / Ctrl+F2 inside the frame closes the preview (the frame is sandboxed, so it can only post a message). */
const CLOSE =
  `<script>addEventListener("keydown",e=>{if(e.key==="Escape"||(e.key==="F2"&&(e.ctrlKey||e.metaKey)))parent.postMessage("jw-preview-close","*")})</script>`;

/** The file as a browser in `scheme` shows it: its dark-mode rules are switched on or off, so the toggle never depends on the OS. */
export const asBrowser = (html: string, scheme: "light" | "dark"): string =>
  html.replace(/\(prefers-color-scheme:\s*dark\)/g, scheme === "dark" ? "all" : "not all").replace(/<\/body>/, `${CLOSE}</body>`);

export default function Preview(): JSX.Element {
  const [scheme, setScheme] = useLocal<"light" | "dark">(dark() ? "dark" : "light");
  const html = useRef(fileHtml()); // built once per opening: the preview is a snapshot
  const root = useRef<HTMLDivElement | null>(null);
  const close = () => previewOpen.set(false);
  onMount(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.preventDefault(), e.stopPropagation(), close());
    const msg = (e: MessageEvent) => e.data === "jw-preview-close" && e.source === root.current?.querySelector("iframe")?.contentWindow && close();
    addEventListener("keydown", esc, true);
    addEventListener("message", msg);
    root.current?.querySelector<HTMLElement>(".jw-preview-close")?.focus();
    onCleanup(() => (removeEventListener("keydown", esc, true), removeEventListener("message", msg)));
  });
  const mode = (s: "light" | "dark", label: string) => (
    <button
      type="button"
      class={`jw-btn text${scheme === s ? " on" : ""}`}
      aria-pressed={String(scheme === s)}
      onClick={() => setScheme(s)}
    >
      {label}
    </button>
  );
  return (
    <div class="jw-preview" role="dialog" aria-label="Browser preview" ref={root}>
      <div class="jw-preview-bar">
        <Icon name="eye" size={16} />
        <b>Browser preview</b>
        <span class="jw-preview-note">
          The saved file as a web browser shows it ({fileDisplay() === "web" ? "web page" : "pages"} — change in Document ▸ In a browser)
        </span>
        <span class="jw-preview-modes" role="group" aria-label="Browser colour mode">
          {mode("light", "Light browser")}
          {mode("dark", "Dark browser")}
        </span>
        <button type="button" class="jw-btn text jw-preview-close" title="Close (Esc)" onClick={close}>Close</button>
      </div>
      {/* no allow-same-origin: the file's own scripts (pager, stale check) run, but cannot reach the app */}
      <iframe class="jw-preview-frame" title="Saved file preview" sandbox="allow-scripts" srcDoc={asBrowser(html.current, scheme)} />
    </div>
  );
}
