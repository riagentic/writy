// Writy — root layout: ribbon, page canvas (+ source pane), status bar, overlays.
import type { JSX } from "aio";
import { effect, onCleanup, onGlobalKey, onMount, useRef } from "aio/air";
import { prefs } from "./cell/prefs.ts";
import { pasteFormat, stepSize } from "./editor/commands.ts";
import { beforeLeave, doc, docTitle, getView, metaGet, mount, newDoc, open, preparePrint, print, save } from "./editor/session.ts";
import { setZoom as setNodeZoom } from "./editor/store.ts";
import { docCss } from "./core/index.ts";
import Ribbon from "./ui/Ribbon.tsx";
import StatusBar from "./ui/StatusBar.tsx";
import Backstage from "./ui/Backstage.tsx";
import SourcePane from "./ui/SourcePane.tsx";
import Slideshow, { present } from "./ui/Slideshow.tsx";
import Preview from "./ui/Preview.tsx";
import { backstage, findMode, hfOpen, painter, previewOpen, reviewPane, settingsOpen } from "./ui/state.ts";
import Settings from "./ui/Settings.tsx";
import HeaderFooter from "./ui/HeaderFooter.tsx";
import NavPane from "./ui/NavPane.tsx";
import ContextMenu from "./ui/ContextMenu.tsx";
import { editLink, paste, toggleTrack } from "./ui/actions.ts";
import { showShortcuts } from "./ui/shortcuts.ts";
import { setZoom, zoomBy } from "./ui/zoom.ts";
import ReviewPane from "./ui/ReviewPane.tsx";
import FindBar from "./ui/FindBar.tsx";
import { GAP, type Geometry, geometry, hfText, pages, PX } from "./ui/paper.ts";
import { type Box, onRelayout, paginate } from "./editor/paginate.ts";

/** The document's own theme CSS, minus page-level rules that belong to the app. */
function themeCss(meta: string, css: string): string {
  const c = [];
  if (meta) c.push({ t: "raw", format: "meta", s: meta.endsWith("\n") ? meta : meta + "\n" });
  if (css) c.push({ t: "raw", format: "css", s: css });
  return docCss({ t: "doc", c }).replace(/(^|\n)(html|body)\{[^}]*\}/g, "").replace(/@page\{[^}]*(\{[^}]*\}[^}]*)*\}/g, "");
}

/** Live page box for the paginator (print layout only). */
const box = (): Box | null => {
  if (prefs.layout !== "print") return null;
  const g = geometry(metaGet());
  return { page: g.h * PX, gap: GAP, top: g.padTop * PX, bottom: g.padBottom * PX };
};

/** One sheet per page behind the text, each with its own header and footer. */
function Sheets(p: { title: string; header: string; footer: string; g: Geometry }): JSX.Element {
  const total = pages.value.total;
  const step = p.g.h * PX + GAP;
  const line = (cls: string, parts: string[], mm: number) =>
    parts.length
      ? (
        <div class={`jw-hf ${cls}`} style={{ "--hf": `${mm}mm`, padding: `0 ${p.g.padRight}mm 0 ${p.g.padLeft}mm` }}>
          <span>{parts[0]}</span>
          <span>{parts[1]}</span>
          <span>{parts[2]}</span>
        </div>
      )
      : null;
  return (
    <div class="jw-sheets" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} class="jw-sheet" style={{ top: `${i * step}px` }}>
          {line("head", hfText(p.header, p.title, i + 1, total), p.g.padTop / 2)}
          {line("foot", hfText(p.footer, p.title, i + 1, total), p.g.padBottom / 2)}
        </div>
      ))}
    </div>
  );
}

function Paper(): JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const meta = (doc.meta.value, metaGet());
  const g = geometry(meta);
  const zoom = prefs.zoom / 100;
  const print = prefs.layout === "print";
  const title = (doc.heading.value, docTitle(meta));
  setNodeZoom(zoom);
  onMount(() => {
    let raf = 0;
    const where = () => {
      const sc = document.querySelector<HTMLElement>(".jw-canvas"), paper = sc?.firstElementChild as HTMLElement | null;
      if (!sc || !paper) return;
      const r = paper.getBoundingClientRect();
      const step = (geometry(metaGet()).h * PX + GAP) * (r.height / (paper.offsetHeight || 1)); // on-screen px (zoom)
      const p = pages.peek();
      const y = sc.getBoundingClientRect().top + sc.clientHeight / 3 - r.top;
      const current = Math.min(p.total, Math.max(1, Math.floor(y / step) + 1));
      if (current !== p.current) pages.set({ ...p, current });
    };
    const layout = () =>
      raf ||= requestAnimationFrame(() => {
        raf = 0;
        const v = getView();
        if (!v) return;
        const total = paginate(v, box());
        document.querySelector<HTMLElement>(".jw-paper")?.style.setProperty("--sheets", String(total));
        if (total !== pages.peek().total) pages.set({ ...pages.peek(), total });
        where();
      });
    onRelayout(layout); // every document change (the page box keeps its height, so ResizeObserver alone misses edits)
    const ro = new ResizeObserver(layout);
    onCleanup(() => ro.disconnect()); // here, not after the await: onCleanup only attaches during onMount
    mount(host.current!).then(() => (ro.observe(getView()!.dom), layout()));
    onCleanup(effect(() => void (doc.meta.value, prefs.layout, prefs.zoom, layout())));
    const dbl = (e: MouseEvent) => {
      const paper = (e.target as Element).closest?.(".jw-paper.print") as HTMLElement | null;
      if (!paper) return;
      const g = geometry(metaGet());
      const r = paper.getBoundingClientRect();
      const y = ((e.clientY - r.top) * paper.offsetHeight) / (r.height || 1) % (g.h * PX + GAP);
      if (y < g.padTop * PX || (y > (g.h - g.padBottom) * PX && y < g.h * PX)) (e.preventDefault(), hfOpen.set(true));
    };
    document.addEventListener("dblclick", dbl);
    // Ctrl+wheel zooms the document (not the whole window)
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !(e.target as Element).closest?.(".jw-canvas")) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
    };
    document.addEventListener("wheel", wheel, { passive: false });
    onCleanup(() => document.removeEventListener("wheel", wheel));
    onCleanup(() => document.removeEventListener("dblclick", dbl));
    const onScroll = (e: Event) => (e.target as Element).classList?.contains("jw-canvas") && where();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.fonts?.addEventListener("loadingdone", layout);
    onCleanup(() => (document.removeEventListener("scroll", onScroll, { capture: true }), document.fonts?.removeEventListener("loadingdone", layout)));
  });
  const style = print
    ? { "--pw": `${g.w}mm`, "--ph": `${g.h}mm`, "--pm": g.pad, "--gap": `${GAP}px`, "--sheets": String(pages.peek().total), zoom: String(zoom) }
    : { "--pw": "none", "--ph": "0", "--pm": "24px 48px", zoom: String(zoom) };
  return (
    <div class="jw-canvas">
      <div class={`jw-paper ${print ? "print" : "web"}`} style={style}>
        {print ? <Sheets title={title} header={meta.header ?? ""} footer={meta.footer ?? ""} g={g} /> : null}
        <div class="jw-host" ref={host} />
      </div>
    </div>
  );
}

function ThemeStyle(): JSX.Element {
  const meta = doc.meta.value;
  const v = getView();
  if (!doc.ready.value || !v) return <style id="jw-doc-css" />;
  const css = themeCss(meta || String(v.state.doc.attrs.meta ?? ""), String(v.state.doc.attrs.css ?? ""));
  return <style id="jw-doc-css">{css}</style>;
}

/** F6 / Shift+F6: move between the big areas (ribbon, panes, page, status bar) — Tab belongs to the page (indent). */
function cycleRegion(dir: 1 | -1) {
  const q = (sel: string) => document.querySelector<HTMLElement>(sel);
  const regions = [
    q(".jw-tab.on"),
    q(".jw-nav button"),
    getView()?.dom as HTMLElement | undefined,
    q(".jw-source .cm-content"),
    q(".jw-review button"),
    q(".jw-status button"),
  ].filter((e): e is HTMLElement => !!e);
  const i = regions.findIndex((r) => r.contains(document.activeElement) || r.closest("aside, footer, header")?.contains(document.activeElement));
  regions[(i + dir + regions.length) % regions.length]?.focus();
}

/** Ctrl+] / Ctrl+[: next / previous font size from the caret's current size. */
const withSize = (dir: 1 | -1) => {
  const v = getView();
  if (v) stepSize(v, dir, doc.active.peek().size);
};

export default function App(): JSX.Element {
  effect(() => {
    const m = prefs.dark;
    if (m === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = m;
  });
  effect(() => void document.documentElement.classList.toggle("jw-painting", !!painter.value));
  effect(() => void (document.title = `${doc.dirty.value ? "• " : ""}${doc.name.value} — Writy`)); // window/taskbar title
  const any = { ignoreInInput: false };
  onGlobalKey("s", (e) => (e.preventDefault(), save()), { ...any, mod: true, shift: false });
  onGlobalKey("s", (e) => (e.preventDefault(), save(true)), { ...any, mod: true, shift: true });
  onGlobalKey("o", (e) => (e.preventDefault(), open()), { ...any, mod: true, shift: false });
  onGlobalKey("n", (e) => (e.preventDefault(), newDoc()), { ...any, mod: true, shift: false });
  onGlobalKey("p", (e) => (e.preventDefault(), print()), { ...any, mod: true, shift: false });
  onGlobalKey("f", (e) => (e.preventDefault(), findMode.set(findMode.peek() || "find")), { ...any, mod: true, shift: false });
  onGlobalKey("h", (e) => (e.preventDefault(), findMode.set("replace")), { ...any, mod: true, shift: false });
  onGlobalKey("k", (e) => (e.preventDefault(), editLink()), { ...any, mod: true, shift: false });
  onGlobalKey("v", (e) => (e.preventDefault(), paste(true)), { ...any, mod: true, shift: true });
  onGlobalKey("f1", (e) => (e.preventDefault(), prefs.toggleRibbon()), { ...any, mod: true });
  onGlobalKey("=", (e) => (e.preventDefault(), zoomBy(1)), { ...any, mod: true, shift: false });
  onGlobalKey("+", (e) => (e.preventDefault(), zoomBy(1)), { ...any, mod: true, shift: true });
  onGlobalKey("-", (e) => (e.preventDefault(), zoomBy(-1)), { ...any, mod: true, shift: false });
  onGlobalKey("0", (e) => (e.preventDefault(), setZoom(100)), { ...any, mod: true, shift: false });
  onGlobalKey("e", (e) => (e.preventDefault(), toggleTrack()), { ...any, mod: true, shift: true });
  onGlobalKey("]", (e) => (e.preventDefault(), withSize(1)), { ...any, mod: true, shift: false });
  onGlobalKey("[", (e) => (e.preventDefault(), withSize(-1)), { ...any, mod: true, shift: false });
  onGlobalKey("f1", (e) => (e.preventDefault(), showShortcuts()), { ...any, mod: false });
  onGlobalKey("/", (e) => (e.preventDefault(), showShortcuts()), { ...any, mod: true });
  onGlobalKey("f6", (e) => (e.preventDefault(), cycleRegion(1)), { ...any, mod: false, shift: false });
  onGlobalKey("f6", (e) => (e.preventDefault(), cycleRegion(-1)), { ...any, mod: false, shift: true });
  onGlobalKey("f2", (e) => (e.preventDefault(), previewOpen.set(!previewOpen.peek())), { ...any, mod: true });
  onGlobalKey("f5", (e) => (e.preventDefault(), present(e.shiftKey)), { ...any, mod: false });
  onMount(() => {
    addEventListener("beforeunload", beforeLeave);
    addEventListener("beforeprint", preparePrint);
    onCleanup(() => removeEventListener("beforeprint", preparePrint));
    // format painter: paint when a mouse selection ends inside the page
    const paint = (e: MouseEvent) =>
      setTimeout(() => {
        const p = painter.peek(), v = getView();
        if (!p || !v || !v.dom.contains(e.target as Node) || v.state.selection.empty) return;
        pasteFormat(v, p.marks);
        if (!p.sticky) painter.set(null);
      });
    const stop = (e: KeyboardEvent) => e.key === "Escape" && painter.peek() && painter.set(null);
    addEventListener("mouseup", paint);
    addEventListener("keydown", stop);
    onCleanup(() => (removeEventListener("beforeunload", beforeLeave), removeEventListener("mouseup", paint), removeEventListener("keydown", stop)));
  });
  return (
    <div class="jw-app">
      <ThemeStyle />
      <Ribbon />
      {findMode.value ? <FindBar /> : null}
      <main class="jw-main">
        {prefs.nav ? <NavPane /> : null}
        <Paper />
        {prefs.showSource ? <SourcePane /> : null}
        {reviewPane.value ? <ReviewPane /> : null}
      </main>
      <StatusBar />
      {backstage.value ? <Backstage /> : null}
      <Slideshow />
      <ContextMenu />
      {settingsOpen.value ? <Settings /> : null}
      {hfOpen.value ? <HeaderFooter /> : null}
      {previewOpen.value ? <Preview /> : null}
    </div>
  );
}
