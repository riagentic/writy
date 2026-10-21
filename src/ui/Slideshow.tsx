// Presentation mode: `::: slide` blocks, or one slide per H1/H2 when there are none. Speaker notes (`::: notes`, right after a
// slide or inside a heading slide) show only in the presenter view (S).
import type { JSX } from "aio";
import { onCleanup, onMount, useLocal, useRef } from "aio/air";
import { docCss, renderHtml } from "../core/index.ts";
import { currentX, getView } from "../editor/session.ts";
import { allAtts } from "../editor/store.ts";
import type { model as M } from "../vendor/pm.js";
import { slideFrom, slideshow } from "./state.ts";

type Slide = { html: string; notes: string };

function slidesOf(html: string): Slide[] {
  const box = document.createElement("div");
  box.innerHTML = html;
  const isNotes = (el: Element | null) => !!el?.classList.contains("notes") && el.tagName === "DIV";
  const explicit = [...box.querySelectorAll("section.jw-slide")].filter((s) => !s.parentElement?.closest("section.jw-slide"));
  if (explicit.length) {
    return explicit.map((s) => {
      const inner = [...s.children].filter(isNotes); // notes typed inside the slide box count too
      inner.forEach((n) => n.remove());
      const after = isNotes(s.nextElementSibling) ? [s.nextElementSibling!] : [];
      return { html: s.innerHTML, notes: [...inner, ...after].map((n) => n.innerHTML).join("") };
    });
  }
  const out: Slide[] = [];
  let cur: Slide = { html: "", notes: "" };
  for (const el of [...box.children]) {
    if (/^H[12]$/.test(el.tagName) && (cur.html || cur.notes)) {
      out.push(cur);
      cur = { html: "", notes: "" };
    }
    if (isNotes(el)) cur.notes += el.innerHTML;
    else if (!el.classList.contains("footnotes")) cur.html += el.outerHTML;
  }
  if (cur.html || cur.notes) out.push(cur);
  return out;
}

/** The slide holding position `pos`, by the same rules as `slidesOf` (pure). */
export function slideAt(doc: M.Node, pos: number): number {
  const top = doc.childBefore(Math.min(pos, doc.content.size)).index;
  const kids = Array.from({ length: doc.childCount }, (_, k) => doc.child(k));
  if (kids.some((n) => n.type.name === "slide")) {
    return Math.max(
      0,
      kids.slice(0, top).filter((n) => n.type.name === "slide").length - (kids[top]?.type.name === "slide" ? 0 : 1),
    );
  }
  return kids.slice(1, top + 1).filter((n) => n.type.name === "heading" && n.attrs.level <= 2).length;
}

/** Start the show: from the first slide, or (Shift+F5) from the one with the caret. */
export function present(fromCaret = false): void {
  const v = getView();
  slideFrom.set(fromCaret && v ? slideAt(v.state.doc, v.state.selection.from) : 0);
  slideshow.set(true);
}

export default function Slideshow(): JSX.Element | null {
  if (!slideshow.value) return null;
  return <Show />;
}

function build(): { slides: Slide[]; css: string } {
  const x = currentX();
  const css = docCss({ t: "doc", c: (x.c ?? []).filter((n) => n.t === "raw" && (n.format === "meta" || n.format === "css")) });
  return { slides: slidesOf(renderHtml(x, allAtts())), css: css.replace(/(^|\n)(html|body)\{[^}]*\}/g, "") };
}

const SKIP = "a,video,audio,button,input,select,textarea,iframe,details,summary";
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const hms = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
  return (hms[0] ? hms : hms.slice(1)).map((n, k) => (k ? String(n).padStart(2, "0") : String(n))).join(":");
};

function Show(): JSX.Element {
  // built once per show, not on every key press
  const deck = useRef<{ slides: Slide[]; css: string } | null>(null);
  deck.current ??= build();
  const { slides, css } = deck.current;
  const last = Math.max(0, slides.length - 1);
  const end = slides.length; // the black "End of slide show" screen after the last slide
  const [i, setI] = useLocal(Math.min(slideFrom.value, last));
  const [blank, setBlank] = useLocal<"" | "black" | "white">("");
  const typed = useLocal(""); // read live (.local) inside the key handler
  const [idle, setIdle] = useLocal(false);
  const [presenter, setPresenter] = useLocal(false);
  const [now, setNow] = useLocal(Date.now());
  const started = useRef(Date.now());
  const root = useRef<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const go = (to: (n: number) => number) => {
    setBlank("");
    typed.set("");
    setI((n: number) => {
      const want = to(n);
      if (n === end && want > n && slides.length) return (queueMicrotask(() => slideshow.set(false)), n); // past the end: leave
      const m = Math.max(0, Math.min(slides.length ? end : 0, want));
      if (m !== n && !still()) stage.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
      return m;
    });
  };
  onMount(() => {
    root.current?.focus();
    root.current?.requestFullscreen?.().catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2500);
    };
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (/^\d$/.test(k)) typed.set((t: string) => (t + k).slice(-4));
      else if (k === "Enter" && typed.local) {
        const to = Math.min(last, +typed.local - 1); // read before go() clears it
        go(() => to);
      } else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n", "N"].includes(k)) go((n) => n + 1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"].includes(k)) go((n) => n - 1);
      else if (k === "Home") go(() => 0);
      else if (k === "End") go(() => last);
      else if (["b", "B", "."].includes(k)) setBlank((b: string) => (b === "black" ? "" : "black"));
      else if (["w", "W", ","].includes(k)) setBlank((b: string) => (b === "white" ? "" : "white"));
      else if (k === "s" || k === "S") setPresenter((v: boolean) => !v);
      else if (k === "r" || k === "R") (started.current = Date.now(), setNow(Date.now()));
      else if (k === "Escape") slideshow.set(false);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", key);
    addEventListener("mousemove", wake);
    wake();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    let wheelAt = 0;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 4 || Date.now() - wheelAt < 350) return; // one slide per flick
      wheelAt = Date.now();
      go((n) => n + Math.sign(e.deltaY));
    };
    addEventListener("wheel", wheel, { passive: true });
    const fs = () => !document.fullscreenElement && slideshow.set(false);
    document.addEventListener("fullscreenchange", fs);
    onCleanup(() => {
      clearTimeout(timer);
      clearInterval(tick);
      removeEventListener("wheel", wheel);
      removeEventListener("keydown", key);
      removeEventListener("mousemove", wake);
      document.removeEventListener("fullscreenchange", fs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    });
  });
  const cur = slides[i];
  const next = slides[i + 1];
  const bar = (
    <div class="jw-show-bar" aria-live="polite">
      {typed.local ? `Go to slide ${typed.local} — Enter` : `${Math.min(i + 1, Math.max(1, slides.length))} / ${Math.max(1, slides.length)}`}{" "}
      · ←/→ move · B/W blank ·{" "}
      <button type="button" class="jw-show-mode" onClick={() => setPresenter(!presenter)}>
        {presenter ? "Audience view (S)" : "Presenter view (S)"}
      </button>{" "}
      · Esc exit
    </div>
  );
  return (
    <div
      class={`jw-show${idle && !presenter ? " idle" : ""}${blank ? ` blank-${blank}` : ""}${presenter ? " presenter" : ""}`}
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-label="Slideshow"
      onClick={(e: MouseEvent) => !(e.target as Element).closest(SKIP) && go((n) => n + 1)}
      onContextMenu={(e: MouseEvent) => (e.preventDefault(), go((n) => n - 1))}
    >
      <style>{css}</style>
      <div class="jw-show-stage jw-page" ref={stage}>
        {cur
          ? <section class="jw-slide" dangerouslySetInnerHTML={{ __html: cur.html }} />
          : slides.length
          ? <p class="jw-show-end">End of slide show — click or press Esc to exit.</p>
          : (
            <section class="jw-slide jw-show-empty">
              <h1>Nothing to present yet</h1>
              <p>Each Heading 1 or Heading 2 starts a new slide. Add one, then press F5.</p>
            </section>
          )}
      </div>
      {presenter
        ? (
          <aside class="jw-show-side" aria-label="Presenter view">
            <div class="jw-show-time">
              <span title="Time since the show started (R restarts)">{clock(now - started.current)}</span>
              <span class="muted">{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div class="jw-show-label">Next</div>
            <div class="jw-show-next jw-page">
              {next ? <section class="jw-slide" dangerouslySetInnerHTML={{ __html: next.html }} /> : <p class="muted">End of the show</p>}
            </div>
            <div class="jw-show-label">Notes</div>
            <div class="jw-show-notes" dangerouslySetInnerHTML={{ __html: cur?.notes || '<p class="muted">No notes for this slide.</p>' }} />
          </aside>
        )
        : null}
      {bar}
    </div>
  );
}
