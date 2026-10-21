// Word count & friends for a document range (pure).
import type { model as M } from "../vendor/pm.js";

export type Stats = { words: number; chars: number; charsNoSpaces: number; paragraphs: number };

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

export function textStats(doc: M.Node, from = 0, to = doc.content.size): Stats {
  const text = doc.textBetween(from, to, "\n", " ");
  let paragraphs = 0;
  doc.nodesBetween(from, to, (n) => {
    if (n.isTextblock && n.textContent.trim()) paragraphs++;
    return !n.isTextblock;
  });
  return {
    words: (text.match(WORD) ?? []).length,
    chars: text.replace(/\n/g, "").length,
    charsNoSpaces: text.replace(/\s/g, "").length,
    paragraphs,
  };
}
