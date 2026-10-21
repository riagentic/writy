// Sheet cell styles (pure). Stored on the sheet as `cells="B2:b bg=#fff3a3;C:al=r"`: a target (a column, for every body row,
// or one cell) and its tokens. Later rules win per property; a cell rule beats its column. core/src/html.rs reads the same text.
import { colIndex } from "./refs.ts";

export type Style = { b?: boolean; i?: boolean; al?: "l" | "c" | "r"; fg?: string; bg?: string; wr?: true; bd?: true };
export type Patch = { [K in keyof Style]?: Style[K] | null };
type Rule = [target: string, style: Style];

const COLOR = /^#[0-9a-f]{3,8}$/i;
const TARGET = /^([A-Z]{1,3})(\d*)$/;

export function parseStyles(s: string): Rule[] {
  return String(s || "").split(";").flatMap((rule): Rule[] => {
    const [t, body = ""] = rule.split(/:(.*)/s, 2);
    if (!TARGET.test(t?.trim() ?? "")) return [];
    const st: Style = {};
    for (const tok of body.trim().split(/\s+/)) {
      const [k, v] = tok.split("=", 2);
      if (k === "b" || k === "i") st[k] = v !== "0";
      else if ((k === "wr" || k === "bd") && v === undefined) st[k] = true;
      else if (k === "al" && (v === "l" || v === "c" || v === "r")) st.al = v;
      else if ((k === "fg" || k === "bg") && COLOR.test(v ?? "")) st[k] = v;
    }
    return Object.keys(st).length ? [[t.trim(), st]] : [];
  });
}

export function writeStyles(rules: Rule[]): string {
  return rules.map(([t, s]) => {
    const toks = [
      s.b !== undefined && (s.b ? "b" : "b=0"),
      s.i !== undefined && (s.i ? "i" : "i=0"),
      s.al && `al=${s.al}`,
      s.fg && `fg=${s.fg}`,
      s.bg && `bg=${s.bg}`,
      s.wr && "wr",
      s.bd && "bd",
    ].filter(Boolean);
    return toks.length ? `${t}:${toks.join(" ")}` : "";
  }).filter(Boolean).join(";");
}

/** The style a cell shows: column rules (body rows only), then its own rules. */
export function styleAt(rules: Rule[], r: number, c: number, head: number): Style {
  const out: Style = {};
  for (const pass of ["col", "cell"] as const) {
    for (const [t, s] of rules) {
      const m = TARGET.exec(t)!;
      if (colIndex(m[1]) !== c) continue;
      if (pass === "col" ? !m[2] && r >= head : m[2] && +m[2] - 1 === r) Object.assign(out, s);
    }
  }
  return out;
}

/** Apply `patch` (null removes a property) to each target; a column target also clears that property from its cells. */
export function applyStyle(s: string, targets: string[], patch: Patch): string {
  const rules = parseStyles(s);
  const keys = Object.keys(patch) as (keyof Style)[];
  for (const t of targets) {
    if (!TARGET.exec(t)![2]) {
      for (const [rt, st] of rules) if (rt !== t && TARGET.exec(rt)![1] === t) keys.forEach((k) => delete st[k]);
    }
    let rule = rules.find(([rt]) => rt === t);
    if (!rule) rules.push(rule = [t, {}]);
    for (const k of keys) {
      if (patch[k] === null || patch[k] === undefined) delete rule[1][k];
      else (rule[1] as Record<string, unknown>)[k] = patch[k];
    }
  }
  return writeStyles(rules);
}

/** Inline CSS for a style. */
export function styleCss(s: Style): string {
  return [
    s.b !== undefined && `font-weight:${s.b ? 700 : 400}`,
    s.i !== undefined && `font-style:${s.i ? "italic" : "normal"}`,
    s.al && `text-align:${{ l: "left", c: "center", r: "right" }[s.al]}`,
    s.fg && `color:${s.fg}`,
    s.bg && `background:${s.bg}`,
    s.wr && "white-space:pre-wrap",
    s.bd && "border:1px solid #000 !important", // beats the editor's grid lines
  ].filter(Boolean).join(";");
}

/** Cell targets follow rows that moved (`to[from]` = new 0-based row; sorting). Works for `cells` and `fmt` alike. */
export function moveRows(spec: string, to: Map<number, number>): string {
  return String(spec || "").split(";").filter(Boolean).map((rule) => {
    const m = /^([A-Z]{1,3})(\d+):/.exec(rule);
    const r = m ? to.get(+m[2] - 1) : undefined;
    return m && r !== undefined ? `${m[1]}${r + 1}${rule.slice(m[0].length - 1)}` : rule;
  }).join(";");
}

/** More / fewer decimals on an Excel number format (General takes the decimals of the value shown). */
export function stepDecimals(code: string, dir: 1 | -1, shown = ""): string {
  const base = code || ((d) => (d ? `0.${"0".repeat(d)}` : "0"))(/\.(\d+)/.exec(shown)?.[1].length ?? 0);
  const m = /0(\.(0+))?(?=[^0]*$)/.exec(base);
  if (!m) return code;
  const n = Math.max(0, (m[2]?.length ?? 0) + dir);
  return base.slice(0, m.index) + (n ? `0.${"0".repeat(n)}` : "0") + base.slice(m.index + m[0].length);
}
