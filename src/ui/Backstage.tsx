// File menu ("backstage"): new, open, recent, save, export, print.
import type { JSX } from "aio";
import { onMount, useRef } from "aio/air";
import { Icon } from "./icons.tsx";
import { ago } from "./time.ts";
import { count } from "./text.ts";
import type { Recent } from "../cell/prefs.ts";
import { prefs } from "../cell/prefs.ts";
import { doc, exportAs, newDoc, open, print, save } from "../editor/session.ts";
import { backstage, settingsOpen } from "./state.ts";
import { templates } from "../doc/templates.ts";

const close = () => backstage.set(false);
const act = (f: () => unknown) => async () => {
  close();
  await f();
};

function Item(p: { icon: string; label: string; hint?: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" class="jw-bs-item" aria-label={p.label} onClick={p.onClick}>
      <Icon name={p.icon} size={22} />
      <span>
        <b>{p.label}</b>
        {p.hint ? <small>{p.hint}</small> : null}
      </span>
    </button>
  );
}

function row(r: Recent): JSX.Element {
  const on = prefs.pinned.includes(r.path);
  return (
    <li key={r.path}>
      <button type="button" class="jw-recent-item" aria-label={`Open ${r.name}`} title={r.path} onClick={act(() => open(r.path))}>
        <Icon name="page" size={20} />
        <span>
          <b>{r.name}</b>
          <small>{r.path.replace(/[\\/][^\\/]*$/, "")}</small>
        </span>
        <time title={new Date(r.at).toLocaleString()}>{ago(r.at)}</time>
      </button>
      <button
        type="button"
        class={`jw-mini${on ? " on" : ""}`}
        aria-label={`${on ? "Unpin" : "Pin"} ${r.name}`}
        aria-pressed={on ? "true" : "false"}
        title={on ? "Unpin" : "Pin to the top of the list"}
        onClick={() => prefs.togglePin(r.path)}
      >
        <Icon name="pin" size={14} />
      </button>
      <button type="button" class="jw-mini" aria-label={`Forget ${r.name}`} title="Remove from list" onClick={() => prefs.forget(r.path)}>×</button>
    </li>
  );
}

/** Arrow keys move between the menu's buttons; Escape goes back to the document. */
function keys(e: KeyboardEvent) {
  if (e.key === "Escape") return close();
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const all = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button")];
  const i = all.indexOf(document.activeElement as HTMLElement);
  all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  e.preventDefault();
}

export default function Backstage(): JSX.Element | null {
  if (!backstage.value) return null;
  return <Menu />;
}

function Menu(): JSX.Element {
  const root = useRef<HTMLDivElement | null>(null);
  onMount(() => root.current?.querySelector<HTMLElement>(".jw-bs-item")?.focus());
  const pinned = prefs.recent.filter((r) => prefs.pinned.includes(r.path));
  const rest = prefs.recent.filter((r) => !prefs.pinned.includes(r.path));
  return (
    <div class="jw-backstage" role="dialog" aria-modal="true" aria-label="File menu" ref={root} onKeyDown={keys}>
      <aside class="jw-bs-side">
        <button type="button" class="jw-bs-back" aria-label="Back to document" onClick={close}>← Back</button>
        <Item icon="new" label="New blank" hint="Ctrl+N" onClick={act(() => newDoc())} />
        <Item icon="open" label="Open…" hint="html, dj, md, docx, odt, doc, rtf, pdf, txt" onClick={act(() => open())} />
        <Item icon="save" label="Save" hint="Ctrl+S" onClick={act(() => save())} />
        <Item icon="save" label="Save as…" hint="Ctrl+Shift+S" onClick={act(() => save(true))} />
        <Item icon="print" label="Print / PDF…" hint="Ctrl+P" onClick={act(print)} />
        <Item icon="export" label="Export Djot (.dj)" hint="plain-text source" onClick={act(() => exportAs("dj"))} />
        <Item icon="export" label="Export Markdown (.md)" hint="simplified" onClick={act(() => exportAs("md"))} />
        <Item icon="export" label="Export Word (.docx)" hint="via LibreOffice" onClick={act(() => exportAs("docx"))} />
        <Item icon="export" label="Export OpenDocument (.odt)" hint="via LibreOffice" onClick={act(() => exportAs("odt"))} />
        <span class="jw-spacer" />
        <Item icon="gear" label="Options" hint="theme, your name, view" onClick={act(() => settingsOpen.set(true))} />
      </aside>
      <section class="jw-bs-main">
        <h2>New</h2>
        <div class="jw-templates">
          {templates().map((t) => (
            <button key={t.id} type="button" class="jw-tpl" aria-label={`New ${t.name}`} onClick={act(() => newDoc(t.src))}>
              <span class={`jw-tpl-thumb t-${t.id}`} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <b>{t.name}</b>
              <small>{t.hint}</small>
            </button>
          ))}
        </div>
        <h2>Recent</h2>
        {prefs.recent.length === 0 ? <p class="muted">No recent documents yet. Files you open or save appear here.</p> : null}
        {pinned.length ? <h3 class="jw-recent-group">Pinned</h3> : null}
        <ul class="jw-recent">{pinned.map(row)}</ul>
        {pinned.length && rest.length ? <h3 class="jw-recent-group">Earlier</h3> : null}
        <ul class="jw-recent">{rest.map(row)}</ul>
        <div class="jw-bs-info">
          <h3>{doc.name.value}</h3>
          <p class="muted">{doc.path.value || "Not saved yet"}</p>
          <p class="muted">{count(doc.words.value, "word")} · {count(doc.chars.value, "character")}</p>
          <p class="muted">
            Writy saves one <b>.html</b> file: it opens in any browser and its Djot source stays readable in any text editor.
          </p>
        </div>
      </section>
    </div>
  );
}
