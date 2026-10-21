// XAST — the document tree shared with the Rust core (core/src/ast.rs), as JSON.
export type Attrs = Record<string, string>;

export type X = {
  t: string;
  a?: Attrs;
  c?: X[];
  s?: string;
  level?: number;
  marker?: string;
  start?: number;
  task?: boolean;
  tight?: boolean;
  checked?: boolean | null;
  head?: boolean;
  align?: string;
  class?: string;
  lang?: string;
  format?: string;
  label?: string;
  href?: string;
  src?: string;
  display?: boolean;
};

/** An embedded file: `#att:<name>` in the document. */
export type Att = { name: string; mime: string; b64: string };

export const NBSP = " ";

export const str = (s: string): X => ({ t: "str", s });
export const para = (c: X[], a: Attrs = {}): X => ({ t: "para", a, c });

/** Plain text of a subtree. */
export function textOf(n: X): string {
  if (n.t === "str" || n.t === "verb" || n.t === "math") return n.s ?? "";
  if (n.t === "soft") return " ";
  if (n.t === "hard") return "\n";
  return (n.c ?? []).map(textOf).join("");
}

/** Remove keys from an attribute map (pure). */
export function omit(a: Attrs | undefined, keys: string[]): Attrs {
  const o: Attrs = {};
  for (const [k, v] of Object.entries(a ?? {})) if (!keys.includes(k)) o[k] = v;
  return o;
}

/** Walk every node (pre-order). */
export function walk(n: X, f: (n: X) => void): void {
  f(n);
  for (const k of n.c ?? []) walk(k, f);
}
