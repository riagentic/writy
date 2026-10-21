import { assertEquals } from "@std/assert";
import { djotParse, djotWrite, ready } from "../src/core/index.ts";
import { fromPM, toPM } from "../src/editor/convert.ts";

await ready();
const canon = (s: string) => djotWrite(djotParse(s));
const viaEditor = (s: string) => djotWrite(fromPM(toPM(djotParse(s))));

const CASES: Record<string, string> = {
  basics: "# Title\n\nA _simple_ *para* with [red]{color=red} and `code` and [link](https://x.y).",
  attrs: "{align=center}\nCentered para.",
  lists: "- one\n- two\n\n1. a\n2. b",
  tasks: "- [ ] todo\n- [x] done",
  nested: "- a\n\n  - b\n  - c\n- d",
  quote: "> quoted\n>\n> two",
  table: "| Item | Qty |\n|:-----|----:|\n| Milk | 2 |\n\n^ Order",
  rich: "{head=1}\n::: table\n- - A\n  - B\n- - []{colspan=2} merged\n:::",
  sheet: '{#sales fmt="D:0.00"}\n``` =sheet\n| Item | Qty |\n|------|-----|\n| Milk | =1+1 |\n```',
  calc: 'Total [4.90]{calc="sales!D4"} €.',
  chart: '{data="sales!A1:B2" type=bar}\n::: chart\n:::',
  shape: '{fill=none h=20mm kind=rect stroke="#1a5fb4" w=40mm x=0mm y=0mm}\n::: shape\nHello\n:::',
  footnote: "Text[^1].\n\n[^1]: Note.",
  meta: "``` =meta\ntitle: Hi\n```\n\n# Hi",
  code: "```js\nlet a = 1;\n```",
  hr: "* * *\n\n{.page-break}\n* * *",
  empty: "Para\n\n\\ \n\nAfter blank",
  marks: "{=mark=} {+ins+} {-del-} x^2^ H~2~O",
  math: "Euler $`e^{i\\pi}+1=0`.",
  image: "![Logo](#att:logo.png){width=30mm}",
  dl: ": Term\n\n  Definition",
  div: "::: note\nInside.\n:::",
  slide: "::: slide\n# One\n:::",
  toc: "::: toc\n:::",
  hard: "a\\\nb",
};

for (const [name, src] of Object.entries(CASES)) {
  Deno.test(`editor round-trip: ${name}`, () => {
    assertEquals(viaEditor(src), canon(src));
  });
}
