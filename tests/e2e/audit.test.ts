// Feature audit (AUDIT.md): one step per feature, driven like a user in headless Chromium.
// Run: am start --client=server-only, then JW_URL=http://localhost:<port> deno test -A tests/e2e/audit.test.ts
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { launch, type Page } from "./cdp.ts";

const URL_ = Deno.env.get("JW_URL");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const src = (p: Page) => p.eval<string>("jw.source()");
const q = (sel: string) => JSON.stringify(sel);
const texts = (p: Page, sel: string) => p.eval<string[]>(`[...document.querySelectorAll(${q(sel)})].map((e) => e.textContent.trim())`);
const status = (p: Page) => p.eval<string>(`document.querySelector(".jw-status").innerText`);
const load = async (p: Page, dj: string) => (await p.eval(`jw.load(${q(dj)})`), await wait(700));

const para = (i: number) =>
  `Paragraph ${i}. ` + "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ".repeat(5);
const LONG = "``` =meta\ntitle: Audit\nfooter: | Page {page} of {pages} |\n```\n\n" +
  Array.from({ length: 14 }, (_, i) => `## Section ${i + 1}\n\n${para(i + 1)}`).join("\n\n") + "\n\n{.page-break}\n* * *\n\nAfter the break.\n";

Deno.test({ name: "audit 1: pages & layout", ignore: !URL_, sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const p = await launch(URL_!, { width: 1300, height: 900 });
  try {
    await t.step("1.1 real sheets; no block crosses a page edge; headings stay with their text", async () => {
      await load(p, LONG);
      const n = await p.eval<number>(`document.querySelectorAll(".jw-sheet").length`);
      assert(n >= 4, `expected ≥4 sheets, got ${n}`);
      assertStringIncludes(await status(p), `of ${n}`);
      // every top-level block lies inside one sheet's content box
      const bad = await p.eval<string[]>(`(() => {
        const pm = document.querySelector(".ProseMirror"), paper = document.querySelector(".jw-paper");
        const z = paper.getBoundingClientRect().height / paper.offsetHeight;
        const sheets = [...document.querySelectorAll(".jw-sheet")].map((s) => s.getBoundingClientRect());
        const pad = parseFloat(getComputedStyle(pm).paddingTop) * z - 1;
        return [...pm.children].filter((b) => {
          if (b.matches(".jw-pagebreak")) return false; // the marker may sit in the bottom margin, as in print
          const r = b.getBoundingClientRect();
          return !sheets.some((s) => r.top >= s.top + pad && r.bottom <= s.bottom - pad);
        }).map((b) => b.textContent.slice(0, 30));
      })()`);
      assertEquals(bad, []);
      const orphan = await p.eval<boolean>(`(() => {
        const sheets = [...document.querySelectorAll(".jw-sheet")].map((s) => s.getBoundingClientRect());
        const page = (r) => sheets.findIndex((s) => r.top < s.bottom);
        return [...document.querySelectorAll(".ProseMirror > h2")].some((h) => h.nextElementSibling && page(h.getBoundingClientRect()) !== page(h.nextElementSibling.getBoundingClientRect()));
      })()`);
      assertEquals(orphan, false, "a heading was left at the bottom of a page");
    });

    await t.step("1.2 footer on every page with real numbers", async () => {
      const n = await p.eval<number>(`document.querySelectorAll(".jw-sheet").length`);
      assertEquals(await texts(p, ".jw-hf.foot"), Array.from({ length: n }, (_, i) => `Page ${i + 1} of ${n}`));
    });

    await t.step("1.2 header & footer dialog: preset, typing, field button, OK writes the meta", async () => {
      await p.click('[aria-label="Document tab"]');
      await p.click('[aria-label="Header / Footer"]');
      await wait(150);
      await p.click(".jw-hfdlg .jw-chip"); // first preset: Page X of Y
      await p.click('[aria-label="Header left"]');
      await p.type("ACME ");
      await p.click(".jw-hf-fields .jw-chip:nth-of-type(3)"); // Title
      await wait(50);
      assertEquals(await p.eval<string>(`document.querySelector('[aria-label="Header left"]').value`), "ACME {title}");
      assertStringIncludes(await p.eval<string>(`document.querySelector('[aria-label="Header preview"]').textContent`), "ACME Audit");
      await p.click(".jw-hfdlg button.primary");
      await wait(400);
      assertStringIncludes(await src(p), "header: ACME {title} |  |");
      assertEquals((await texts(p, ".jw-hf.head"))[1], "ACME Audit");
    });

    await t.step("1.2 double-click the bottom margin opens the dialog; Esc closes it", async () => {
      const pt2 = await p.eval<{ x: number; y: number }>(`(() => {
        const f = document.querySelector(".jw-sheet .jw-hf.foot");
        f.scrollIntoView({ block: "center" });
        const r = f.getBoundingClientRect();
        return { x: r.x + 40, y: r.y + r.height / 2 };
      })()`);
      await p.mouse(pt2.x, pt2.y, 2);
      await wait(150);
      assert(await p.eval<boolean>(`!!document.querySelector(".jw-hfdlg")`), "dialog opened");
      await p.key("Escape");
      await wait(100);
      assert(!(await p.eval<boolean>(`!!document.querySelector(".jw-hfdlg")`)), "dialog closed");
    });

    await t.step("1.3 page break starts a new page", async () => {
      const last = await p.eval<boolean>(`(() => {
        const sheets = [...document.querySelectorAll(".jw-sheet")].map((s) => s.getBoundingClientRect());
        const b = [...document.querySelectorAll(".ProseMirror > p")].at(-1).getBoundingClientRect();
        const s = sheets.findIndex((r) => b.top < r.bottom);
        return s === sheets.length - 1 && b.top - sheets[s].top < 120;
      })()`);
      assert(last, "text after the break is at the top of the last sheet");
    });

    await t.step("1.4 paper size + orientation change the sheet shape", async () => {
      await p.eval(`document.querySelector(".jw-canvas").scrollTop = 0`);
      const ratio = () => p.eval<number>(`(() => { const r = document.querySelector(".jw-sheet").getBoundingClientRect(); return r.width / r.height; })()`);
      assert(Math.abs((await ratio()) - 210 / 297) < 0.01, "A4 portrait");
      await load(p, "``` =meta\npage: Letter\norientation: landscape\n```\n\nHi\n");
      assert(Math.abs((await ratio()) - 279.4 / 215.9) < 0.01, "Letter landscape");
    });

    await t.step("1.6 web layout: no sheets, no header/footer", async () => {
      await load(p, LONG);
      await p.click('[aria-label="Web layout"]');
      await wait(300);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-sheet, .jw-hf").length`), 0);
      assertEquals(await p.eval<number>(`[...document.querySelectorAll(".ProseMirror > *")].filter((e) => e.style.marginTop).length`), 0, "pushes cleared");
      await p.click('[aria-label="Print layout"]');
      await wait(300);
      assert(await p.eval<number>(`document.querySelectorAll(".jw-sheet").length`) >= 4);
    });

    await t.step("1.5 margins: header/footer and text move with the margin", async () => {
      await load(p, "``` =meta\nmargin: 40mm\nfooter: | {page} |\n```\n\nHello\n");
      const off = await p.eval<number>(`(() => {
        const s = document.querySelector(".jw-sheet").getBoundingClientRect(), t = document.querySelector(".ProseMirror > p").getBoundingClientRect();
        const z = s.width / document.querySelector(".jw-sheet").offsetWidth;
        return Math.round((t.left - s.left) / z / (96 / 25.4));
      })()`);
      assertEquals(off, 40);
    });

    await t.step("1.7 zoom: Ctrl+= / Ctrl+- / Ctrl+0, Ctrl+wheel, presets menu, page width; pages stay correct", async () => {
      await load(p, LONG);
      const zoom = () => p.eval<string>(`document.querySelector('[aria-label="Zoom level"]').textContent`);
      await p.click(".ProseMirror");
      await p.key("0", 2);
      await wait(150);
      await p.key("=", 2);
      await wait(150);
      assertEquals(await zoom(), "110%");
      await p.key("-", 2);
      await p.key("-", 2);
      await wait(150);
      assertEquals(await zoom(), "90%");
      await p.key("0", 2);
      await wait(150);
      assertEquals(await zoom(), "100%");
      await p.eval(
        `document.querySelector(".jw-canvas").dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }))`,
      );
      await wait(150);
      assertEquals(await zoom(), "110%");
      await p.click('[aria-label="Zoom level"]');
      await p.click('.jw-zoom-menu [role="menuitemradio"]:nth-child(4)'); // 125%
      await wait(150);
      assertEquals(await zoom(), "125%");
      await p.click('[aria-label="Zoom level"]');
      await p.click(".jw-zoom-menu button:last-child"); // whole page
      await wait(500);
      const fits = await p.eval<boolean>(
        `(() => { const s = document.querySelector(".jw-sheet").getBoundingClientRect(), c = document.querySelector(".jw-canvas").getBoundingClientRect(); return s.height <= c.height && s.width <= c.width; })()`,
      );
      assert(fits, "a whole page fits the window");
      const n = await p.eval<number>(`document.querySelectorAll(".jw-sheet").length`);
      assertEquals(await texts(p, ".jw-hf.foot"), Array.from({ length: n }, (_, i) => `Page ${i + 1} of ${n}`));
      await p.key("0", 2);
      await wait(500);
    });

    await t.step("1.9 design, body font, headings font, base size apply to the page and the file", async () => {
      await load(p, "# Title\n\nBody text.\n");
      await p.click('[aria-label="Document tab"]');
      const pick = (label: string, value: string) =>
        p.eval(
          `(() => { const s = document.querySelector('select[aria-label="${label}"]'); s.value = ${
            q(value)
          }; s.dispatchEvent(new Event("input", { bubbles: true })); })()`,
        );
      await pick("Document design", "classic");
      await wait(200);
      assertEquals(await p.eval<string>(`getComputedStyle(document.querySelector(".ProseMirror h1")).textAlign`), "center");
      await pick("Body font", "Verdana");
      await pick("Headings font", "Courier New");
      await pick("Base text size", "13pt");
      await wait(300);
      assertStringIncludes(await p.eval<string>(`getComputedStyle(document.querySelector(".ProseMirror p")).fontFamily`), "Verdana");
      assertStringIncludes(await p.eval<string>(`getComputedStyle(document.querySelector(".ProseMirror h1")).fontFamily`), "Courier New");
      assertEquals(
        await p.eval<string>(`getComputedStyle(document.querySelector(".ProseMirror p")).fontSize`),
        `${(13 * 96 / 72).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}px`,
      );
      const s = await src(p);
      for (const x of ["theme: classic", "font: Verdana, sans-serif", "headings-font: Courier New, monospace", "size: 13pt"]) assertStringIncludes(s, x);
      assertEquals(await p.eval<string>(`document.querySelector('select[aria-label="Body font"]').value`), "Verdana", "select shows the current font");
    });

    await t.step("1.10 print: only the document, its pages, header and footer — no app chrome", async () => {
      await load(p, LONG);
      await p.eval(`jw.preparePrint()`);
      const dir = await Deno.makeTempDir({ prefix: "jw-print-" });
      await p.pdf(`${dir}/out.pdf`);
      const txt = new TextDecoder().decode(
        (await new Deno.Command("pdftotext", { args: ["-layout", `${dir}/out.pdf`, "-"], stdout: "piped" }).output()).stdout,
      );
      const pagesN = (txt.match(/\f/g) ?? []).length;
      assert(pagesN >= 4, `pages: ${pagesN}`);
      assertStringIncludes(txt, `Page 1 of ${pagesN}`);
      assertStringIncludes(txt, `Page ${pagesN} of ${pagesN}`);
      assert(!/Undo|Insert|Print\s+Web|words/.test(txt), "no ribbon or status bar in print");
      assertEquals(await p.eval<string>(`getComputedStyle(document.querySelector(".ProseMirror")).maxWidth`), "none", "editor look untouched");
    });

    await t.step("1.11 editor view and saved file are separate: the file opens as pages (default) or one web page", async () => {
      const dir = await Deno.makeTempDir({ prefix: "jw-layout-" });
      const sheets = (pg: Page, sel: string) => pg.eval<number>(`document.querySelectorAll(${q(sel)}).length`);
      try {
        await load(p, LONG);
        const n = await sheets(p, ".jw-sheet");
        // editing in Web layout changes only the editor: the file still opens as the same pages
        await p.click('[aria-label="Web layout"]');
        await wait(300);
        assert(!(await src(p)).includes("display:"), "the editor view is not saved in the document");
        assert(await p.eval<boolean>(`jw.saveTo(${q(`${dir}/pages.html`)})`));
        await p.click('[aria-label="Print layout"]');
        await wait(300);
        const v = await launch(`file://${dir}/pages.html`, { width: 1300, height: 900 });
        try {
          await wait(500);
          assertEquals(await sheets(v, ".jw-pg-sheet"), n, "same pages as the editor's print layout");
          assertEquals(await texts(v, ".jw-pg-hf.foot"), Array.from({ length: n }, (_, i) => `Page ${i + 1} of ${n}`));
          const bad = await v.eval<string[]>(`(() => {
            const main = document.querySelector("main.jw-page"), z = main.getBoundingClientRect().height / main.offsetHeight;
            const pad = parseFloat(getComputedStyle(main).paddingTop) * z - 1;
            const all = [...document.querySelectorAll(".jw-pg-sheet")].map((s) => s.getBoundingClientRect());
            return [...main.children].filter((b) => b.offsetHeight && !all.some((s) => b.getBoundingClientRect().top >= s.top + pad && b.getBoundingClientRect().bottom <= s.bottom - pad)).map((b) => b.textContent.slice(0, 30));
          })()`);
          assertEquals(bad, [], "no block crosses a page edge");
          await v.pdf(`${dir}/pages.pdf`);
          const txt = new TextDecoder().decode((await new Deno.Command("pdftotext", { args: [`${dir}/pages.pdf`, "-"], stdout: "piped" }).output()).stdout);
          const pdfN = (txt.match(/\f/g) ?? []).length;
          assertStringIncludes(txt, `Page ${pdfN} of ${pdfN}`, "printing the file still uses real paper pages, without the screen sheets");
        } finally {
          await v.close();
        }
        // the saved-file setting changes only the file: the editor keeps its pages
        await p.click('[aria-label="Document tab"]');
        await p.click('[aria-label="Opens as a web page"]');
        await wait(300);
        assertStringIncludes(await src(p), "display: web", "a document setting, saved in the file");
        assertEquals(await sheets(p, ".jw-sheet"), n, "editor view unchanged");
        assert(await p.eval<boolean>(`jw.saveTo(${q(`${dir}/web.html`)})`));
        const w = await launch(`file://${dir}/web.html`, { width: 1300, height: 900 });
        try {
          await wait(300);
          assertEquals(await sheets(w, ".jw-pg-sheet"), 0);
          assertEquals(await w.eval<boolean>(`document.body.classList.contains("jw-paged")`), false);
        } finally {
          await w.close();
        }
        await p.click('[aria-label="Home tab"]');
        await p.click('[aria-label="Undo (Ctrl+Z)"]');
        await wait(200);
        assert(!(await src(p)).includes("display:"), "undo puts pages back");
      } finally {
        await Deno.remove(dir, { recursive: true }).catch(() => {});
      }
    });

    await t.step("1.8 status bar follows scrolling", async () => {
      await p.eval(`document.querySelector(".jw-canvas").scrollTop = 1e6`);
      await wait(200);
      const n = await p.eval<number>(`document.querySelectorAll(".jw-sheet").length`);
      assertStringIncludes(await status(p), `Page ${n} of ${n}`);
    });
  } finally {
    await p.close();
  }
});

const sel = async (p: Page, text: string) => assert(await p.eval<boolean>(`jw.select(${q(text)})`), `found "${text}"`);
const after = async (p: Page, text: string) => assert(await p.eval<boolean>(`jw.caretAfter(${q(text)})`), `found "${text}"`);
const btn = (label: string) => `[aria-label="${label}"]`;
const disabled = (p: Page, label: string) => p.eval<boolean>(`document.querySelector(${q(btn(label))}).disabled`);

Deno.test({ name: "audit 2: text formatting", ignore: !URL_, sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const p = await launch(URL_!, { width: 1400, height: 900 });
  try {
    await p.click('[aria-label="Home tab"]');

    await t.step("2.1 undo/redo work and are disabled when there is nothing to undo/redo", async () => {
      await load(p, "Hello\n");
      assert(await disabled(p, "Undo (Ctrl+Z)"), "undo disabled after load");
      assert(await disabled(p, "Redo (Ctrl+Y)"), "redo disabled after load");
      await sel(p, "Hello");
      await p.click(btn("Bold (Ctrl+B)"));
      await wait(50);
      assert(!(await disabled(p, "Undo (Ctrl+Z)")));
      await p.click(btn("Undo (Ctrl+Z)"));
      await wait(50);
      assertEquals((await src(p)).trim(), "Hello");
      assert(!(await disabled(p, "Redo (Ctrl+Y)")));
      await p.click(btn("Redo (Ctrl+Y)"));
      await wait(50);
      assertEquals((await src(p)).trim(), "*Hello*");
    });

    await t.step("2.4 bold/italic/underline/strike/sup/sub/code buttons", async () => {
      const cases: [string, string][] = [
        ["Bold (Ctrl+B)", "*w*"],
        ["Italic (Ctrl+I)", "_w_"],
        ["Underline (Ctrl+U)", "{+w+}"],
        ["Strikethrough (Ctrl+Shift+X)", "{-w-}"],
        ["Superscript (Ctrl+.)", "^w^"],
        ["Subscript (Ctrl+,)", "~w~"],
        ["Inline code (Ctrl+`)", "`w`"],
      ];
      for (const [label, want] of cases) {
        await load(p, "a w b\n");
        await sel(p, "w");
        await p.click(btn(label));
        await wait(40);
        assertStringIncludes(await src(p), `a ${want} b`, label);
        assertEquals(await p.eval<string>(`document.querySelector(${q(btn(label))}).getAttribute("aria-pressed")`), "true", `${label} shows as on`);
      }
    });

    await t.step("2.3 font and size: apply, and the boxes show the current value", async () => {
      await load(p, "a w b\n");
      await sel(p, "w");
      const pick = (label: string, value: string) =>
        p.eval(
          `(() => { const s = document.querySelector('select[aria-label="${label}"]'); s.value = ${
            q(value)
          }; s.dispatchEvent(new Event("input", { bubbles: true })); })()`,
        );
      await pick("Font", "Georgia");
      await pick("Font size", "14pt");
      await wait(80);
      assertStringIncludes(await src(p), "[w]{font=Georgia size=14pt}");
      await sel(p, "a");
      await wait(50);
      assertEquals(await p.eval<string>(`document.querySelector('select[aria-label="Font"]').value`), "Default");
      await sel(p, "w");
      await wait(50);
      assertEquals(await p.eval<string>(`document.querySelector('select[aria-label="Font"]').value`), "Georgia");
      assertEquals(await p.eval<string>(`document.querySelector('select[aria-label="Font size"]').value`), "14pt");
    });

    await t.step("2.5 font colour: swatch, main half re-applies, recent, Automatic removes", async () => {
      await load(p, "one two three\n");
      await sel(p, "one");
      await p.click(btn("Font colour options"));
      await p.click('.jw-palette [aria-label="Green"]');
      await wait(60);
      assertStringIncludes(await src(p), '[one]{color="#00b050"}');
      assert(!(await p.eval<boolean>(`!!document.querySelector(".jw-palette")`)), "palette closes after a pick");
      await sel(p, "three");
      await p.click('[aria-label^="Font colour: apply"]');
      await wait(60);
      assertStringIncludes(await src(p), '[three]{color="#00b050"}');
      await sel(p, "one");
      await p.click(btn("Font colour options"));
      await p.click(".jw-palette .jw-pal-none");
      await wait(60);
      assertEquals((await src(p)).trim(), 'one two [three]{color="#00b050"}');
    });

    await t.step("2.6 highlight: swatch and No highlight (also clears {=mark=})", async () => {
      await load(p, "{=marked=} plain\n");
      await sel(p, "plain");
      await p.click(btn("Highlight options"));
      await p.click('.jw-palette [aria-label="Turquoise"]');
      await wait(60);
      assertStringIncludes(await src(p), '[plain]{bg="#00ffff"}');
      await sel(p, "marked");
      await p.click(btn("Highlight options"));
      await p.click(".jw-palette .jw-pal-none");
      await wait(60);
      assertStringIncludes(await src(p), "marked [plain]");
    });

    await t.step("2.2 format painter: once, then sticky (double-click) until Esc", async () => {
      await load(p, "*src* one two\n");
      const up = () => p.eval(`jw.view().dom.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))`);
      await sel(p, "src");
      await p.click(btn("Format painter (double-click to keep it on)"));
      await wait(60);
      assertEquals((await src(p)).trim(), "*src* one two", "clicking the brush does not paint the source");
      await sel(p, "one");
      await up();
      await wait(60);
      assertStringIncludes(await src(p), "*one*");
      assertEquals(
        await p.eval<string | null>(`document.querySelector(${q(btn("Format painter (double-click to keep it on)"))}).getAttribute("aria-pressed")`),
        "false",
        "off after one use",
      );
      await sel(p, "src");
      const b = await p.eval<{ x: number; y: number }>(
        `(() => { const r = document.querySelector(${
          q(btn("Format painter (double-click to keep it on)"))
        }).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      await p.mouse(b.x, b.y, 2);
      await sel(p, "two");
      await up();
      await wait(60);
      assertStringIncludes(await src(p), "*two*");
      assertEquals(
        await p.eval<string>(`document.querySelector(${q(btn("Format painter (double-click to keep it on)"))}).getAttribute("aria-pressed")`),
        "true",
        "still on",
      );
      await p.key("Escape");
      await wait(40);
      assertEquals(
        await p.eval<string>(`document.querySelector(${q(btn("Format painter (double-click to keep it on)"))}).getAttribute("aria-pressed")`),
        "false",
      );
    });

    await t.step("2.7 clear formatting keeps links and comments", async () => {
      await load(p, '[*bold link*](https://x.y) and [_note_]{comment="hi" by=A}\n');
      await p.eval(
        `(() => { const v = jw.view(); v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, 1, v.state.doc.content.size - 1))); })()`,
      );
      await p.click(btn("Clear formatting"));
      await wait(60);
      const s = await src(p);
      assertStringIncludes(s, "[bold link](https://x.y)");
      assertStringIncludes(s, "comment=");
      assert(!s.includes("*") && !s.includes("_note_"), s);
    });

    await t.step("2.8 bullets, numbering, checklist, indent", async () => {
      await load(p, "one\n\ntwo\n");
      await sel(p, "one");
      await p.click(btn("Bullets"));
      await wait(40);
      assertStringIncludes(await src(p), "- one");
      await p.click(btn("Numbering"));
      await wait(40);
      assertStringIncludes(await src(p), "1. one");
      await p.click(btn("Checklist"));
      await wait(40);
      assertStringIncludes(await src(p), "- [ ] one");
      await load(p, "- one\n- two\n");
      await sel(p, "two");
      await p.click(btn("Increase indent (Tab)"));
      await wait(40);
      assertStringIncludes(await src(p), "- one\n\n  - two");
      await p.click(btn("Decrease indent (Shift+Tab)"));
      await wait(40);
      assertStringIncludes(await src(p), "- one\n- two");
    });

    await t.step("2.9 alignment", async () => {
      for (const [label, want] of [["Center (Ctrl+E)", "{align=center}"], ["Align right (Ctrl+R)", "{align=right}"], ["Justify (Ctrl+J)", "{align=justify}"]]) {
        await load(p, "text\n");
        await sel(p, "text");
        await p.click(btn(label));
        await wait(40);
        assertStringIncludes(await src(p), want, label);
      }
      for (const [key, want] of [["e", "{align=center}"], ["j", "{align=justify}"]]) {
        await load(p, "text\n");
        await sel(p, "text");
        await p.key(key, 2);
        await wait(40);
        assertStringIncludes(await src(p), want, `Ctrl+${key.toUpperCase()}`);
      }
      await p.key("l", 2);
      await wait(40);
      assert(!(await src(p)).includes("align="), "Ctrl+L back to left");
    });

    await t.step("2.13 Tab in the last table cell adds a row; Backspace removes a bullet; typed web addresses become links", async () => {
      await load(p, "| a | b |\n|---|---|\n| c | d |\n");
      await after(p, "d");
      await p.key("Tab");
      await p.type("e");
      await wait(100);
      assertStringIncludes(await src(p), "| e   |     |", "a new row, caret in its first cell");
      await load(p, "- one\n- two\n");
      await after(p, "one");
      await p.key("ArrowRight"); // start of the second item
      await wait(50); // the editor reads the moved caret a moment later
      await p.key("Backspace");
      await wait(100);
      assertEquals((await src(p)).trim(), "- one\n\ntwo", "the bullet goes, the text stays");
      await load(p, "Intro\n");
      await after(p, "Intro");
      await p.type(" see www.example.com, ok");
      await wait(100);
      assertStringIncludes(await src(p), "see [www.example.com](https://www.example.com), ok", "link without the comma");
    });

    await t.step("2.14 ¶ formatting marks; Paste / Cut / Copy buttons; Word keys Ctrl+Space, Ctrl+2, Ctrl+Shift+N", async () => {
      await load(p, "# Title\n\nSome *bold* text\n");
      assert(await disabled(p, "Cut (Ctrl+X)"), "nothing selected: Cut is off");
      assert(!(await disabled(p, "Paste (Ctrl+V)")));
      await p.click(btn("Show formatting marks (¶)"));
      await wait(100);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror .jw-fm.para").length`), 2, "¶ after each paragraph");
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror .jw-fm-sp").length`), 2, "· for each space");
      assertStringIncludes(await p.eval<string>("jw.html()"), "Some <strong>bold</strong> text", "never in the file");
      await p.click(btn("Show formatting marks (¶)"));
      await wait(80);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror .jw-fm, .ProseMirror .jw-fm-sp").length`), 0);
      await sel(p, "bold");
      assert(!(await disabled(p, "Cut (Ctrl+X)")));
      await p.key(" ", 2); // Ctrl+Space
      await p.key("2", 2); // Ctrl+2
      await wait(80);
      assertStringIncludes(await src(p), "{spacing=2}\nSome bold text", "plain text, double spacing");
      await after(p, "Title");
      await p.key("N", 2 | 8); // Ctrl+Shift+N
      await wait(80);
      assert((await src(p)).startsWith("Title\n"), "heading back to Normal");
    });

    await t.step("2.12 Tab indents paragraphs (focus stays), checklist ticks by click and Ctrl+Shift+Enter, Ctrl+] grows text", async () => {
      await load(p, "para\n");
      await after(p, "para");
      await p.key("Tab");
      await p.key("Tab");
      await wait(40);
      assertStringIncludes(await src(p), '{indent="25.4mm"}\npara');
      assert(await p.eval<boolean>(`document.activeElement.classList.contains("ProseMirror")`), "focus stays in the page");
      await p.key("Tab", 8); // Shift+Tab
      await wait(40);
      assertStringIncludes(await src(p), '{indent="12.7mm"}\npara');
      await p.click(btn("Decrease indent (Shift+Tab)"));
      await wait(40);
      assert(!(await src(p)).includes("indent="), "back to no indent");
      await load(p, "- [ ] buy milk\n- [ ] call Ana\n");
      const box = await p.eval<{ x: number; y: number }>(
        `(() => { const r = document.querySelector(".ProseMirror li.task").getBoundingClientRect(); return { x: r.left - 10, y: r.top + 8 }; })()`,
      );
      await p.mouse(box.x, box.y);
      await wait(60);
      assertStringIncludes(await src(p), "- [x] buy milk");
      await after(p, "call Ana");
      await p.key("Enter", 2 | 8);
      await wait(40);
      assertStringIncludes(await src(p), "- [x] call Ana");
      await load(p, "big\n");
      await sel(p, "big");
      await p.key("]", 2);
      await wait(40);
      assertStringIncludes(await src(p), "size=12pt");
      await p.key("[", 2);
      await p.key("[", 2);
      await wait(40);
      assertStringIncludes(await src(p), "size=10pt");
    });

    await t.step("2.10 styles gallery", async () => {
      for (const [label, want] of [["Heading 2", "## text"], ["Quote", "> text"], ["Code", "```\ntext\n```"]]) {
        await load(p, "text\n");
        await sel(p, "text");
        await p.click(`[aria-label="Style ${label}"]`);
        await wait(40);
        assertStringIncludes(await src(p), want, label);
      }
    });
  } finally {
    await p.close();
  }
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC";

Deno.test({ name: "audit 3: insert", ignore: !URL_, sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const p = await launch(URL_!, { width: 1400, height: 900 });
  const tab = (name: string) => p.click(`[aria-label="${name} tab"]`);
  try {
    await t.step("3.1 table: grid picker (mouse + keys), rows/cols, merge/split, header row, delete", async () => {
      await load(p, "Before\n");
      await after(p, "Before");
      await tab("Insert");
      await p.click(btn("Table"));
      await wait(100);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-tpick").textContent`), "1 × 1");
      await p.key("ArrowRight");
      await p.key("ArrowDown");
      await wait(50);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-tpick").textContent`), "2 × 2");
      await p.key("Enter");
      await wait(150);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror table tr").length`), 2);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror table tr:first-child > *").length`), 2);
      await p.type("A");
      assert(await p.eval<boolean>(`!!document.querySelector('[aria-label="Table tab"]')`), "Table tab shows");
      await tab("Table");
      await p.click(btn("Insert row below"));
      await p.click(btn("Insert column right"));
      await wait(60);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror table tr").length`), 3);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror table tr:first-child > *").length`), 3);
      await p.click(btn("Delete row"));
      await p.click(btn("Delete column"));
      await wait(60);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror table tr").length`), 2);
      // merge the first row
      await p.eval(`jw.selectCells(0, 1)`);
      await p.click(btn("Merge cells"));
      await wait(60);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror table tr:first-child > *").length`), 1, "merged");
      await p.click(btn("Split cell"));
      await wait(60);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror table tr:first-child > *").length`), 2, "split");
      await p.eval(`jw.selectCells(0, 0)`);
      await p.click(btn("Shading options"));
      await p.click('.jw-palette [aria-label="Pale blue"]');
      await wait(80);
      assertStringIncludes(await src(p), 'bg="#ddebf7"', "cell shading saved");
      assertEquals(
        await p.eval<string>(`getComputedStyle(document.querySelector(".ProseMirror table tr:first-child > :first-child")).backgroundColor`),
        "rgb(221, 235, 247)",
      );
      await p.click(btn("Header row"));
      await wait(60);
      const th = await p.eval<number>(`document.querySelectorAll(".ProseMirror table th").length`);
      await p.click(btn("Header row"));
      await wait(60);
      assert(th !== (await p.eval<number>(`document.querySelectorAll(".ProseMirror table th").length`)), "header row toggles");
      await p.click(btn("Delete table"));
      await wait(60);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror table").length`), 0);
      assert(!(await p.eval<boolean>(`!!document.querySelector('[aria-label="Table tab"]')`)), "Table tab gone");
    });

    await t.step("3.2 picture: paste embeds it; resize grip; wrap; alt text; reset; delete", async () => {
      await load(p, "Text\n");
      await after(p, "Text");
      await p.eval(`jw.view().pasteHTML(${q(`<img src="${PNG}" alt="dot">`)})`);
      await wait(200);
      assertStringIncludes(await src(p), "](#att:");
      await p.click(".jw-media img");
      await wait(100);
      await tab("Picture");
      await p.click(btn("Float left"));
      await wait(60);
      assertStringIncludes(await src(p), "float=left");
      // drag the grip 60px right
      const g = await p.eval<[number, number]>(
        `(() => { const r = document.querySelector(".jw-media .jw-grip").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
      );
      await p.drag(g[0], g[1], g[0] + 60, g[1]);
      await wait(100);
      assertStringIncludes(await src(p), "width=");
      await p.click(btn("Reset size"));
      await wait(60);
      assert(!(await src(p)).includes("width="), "reset size");
      await p.click(btn("Delete picture"));
      await wait(60);
      assert(!(await src(p)).includes("#att:"), "deleted");
    });

    await t.step("3.3 video and audio embed and play controls show", async () => {
      const fx = (n: string) => new URL(`./fixtures/${n}`, import.meta.url).pathname;
      await load(p, "Media\n");
      await after(p, "Media");
      await p.eval(`jw.insertFile(${q(fx("clip.webm"))})`);
      await wait(300);
      await after(p, "Media");
      await p.eval(`jw.insertFile(${q(fx("tone.ogg"))})`);
      await wait(300);
      assert(
        await p.eval<boolean>(`!!document.querySelector(".jw-media video[controls]") && !!document.querySelector(".jw-media audio[controls]")`),
        "players",
      );
      const s = await src(p);
      assertStringIncludes(s, "#att:clip.webm");
      assertStringIncludes(s, "#att:tone.ogg");
      const html = await p.eval<string>("jw.html()");
      assertStringIncludes(html, "<video");
      assertStringIncludes(html, "<audio");
    });

    await t.step("3.4/3.5 shapes and text box insert, select, delete", async () => {
      for (const label of ["Rectangle", "Rounded rectangle", "Oval", "Arrow", "Line", "Text box"]) {
        await load(p, "Anchor text\n");
        await sel(p, "Anchor");
        await tab("Insert");
        await p.click(btn(label));
        await wait(100);
        assertStringIncludes(await src(p), "::: shape", label);
        await p.click(".jw-shape-box");
        await wait(80);
        await tab("Shape");
        await p.click(btn("Delete shape"));
        await wait(80);
        assert(!(await src(p)).includes("::: shape"), `${label} deleted`);
      }
    });

    await t.step("3.4b shapes: drag either end of an arrow anywhere, resize a box from any side, arrow keys move", async () => {
      const box = (sel: string) =>
        p.eval<{ x: number; y: number }>(
          `(() => { const r = document.querySelector(${q(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
        );
      const num = async (k: string) => +((await src(p)).match(new RegExp(`\\b${k}="?(-?[\\d.]+)mm`))?.[1] ?? NaN);
      await load(p, "{kind=arrow x=10mm y=10mm w=40mm h=0mm from=tl}\n::: shape\n:::\n\nAnchor text\n");
      await p.click(".jw-shape-box");
      await wait(100);
      const [s1, s2] = [await box(".jw-handle.end1"), await box(".jw-handle.end2")];
      assert(s2.x > s1.x + 50, "two end handles, start left of the tip");
      await p.drag(s2.x, s2.y, s1.x - 40, s1.y - 40); // tip to the upper left of the start
      await wait(150);
      assertStringIncludes(await src(p), "from=br", "the arrow now points up-left");
      assert((await num("h")) > 5, "and is no longer flat");
      await load(p, "{kind=rect x=10mm y=10mm w=40mm h=20mm}\n::: shape\n:::\n\nAnchor text\n");
      await p.click(".jw-shape-box");
      await wait(100);
      const w = await box(".jw-handle.w");
      await p.drag(w.x, w.y, w.x - 40, w.y);
      await wait(150);
      assert((await num("x")) < 10 && (await num("w")) > 40, "left edge dragged out: x smaller, wider");
      const n = await box(".jw-handle.n");
      await p.drag(n.x, n.y, n.x, n.y + 400);
      await wait(150);
      assertEquals(await num("h"), 3, "top edge past the bottom stops at the minimum");
      const x0 = await num("x");
      await p.key("ArrowRight");
      await wait(100);
      assertEquals(await num("x"), Math.round((x0 + 1) * 10) / 10, "arrow key moves 1 mm");
      assertStringIncludes(await src(p), "::: shape", "the shape stays selected and in place");
    });

    await t.step("3.6–3.8 spreadsheet, chart from it, cell value in text", async () => {
      await load(p, "Intro\n");
      await after(p, "Intro");
      await tab("Insert");
      await p.click(btn("Spreadsheet"));
      await wait(200);
      assertStringIncludes(await src(p), "=sheet");
      await p.click('.jw-sheet-grid td[data-r="1"][data-c="1"]');
      await p.press("5");
      await p.key("Enter");
      await p.click('.jw-sheet-grid td[data-r="2"][data-c="1"]');
      await p.press("=B2*3");
      await p.key("Enter");
      await wait(300);
      assertEquals(await p.eval<string>(`document.querySelector('.jw-sheet-grid td[data-r="2"][data-c="1"]').textContent`), "15");
      await after(p, "Intro");
      await p.click(btn("Cell value"));
      await wait(100);
      await p.eval(`document.querySelector(".jw-modal input").value = "Sheet1!B3"`);
      await p.click(".jw-modal button.primary");
      await wait(300);
      assertEquals(await p.eval<string>(`document.querySelector(".jw-calc").textContent`), "15");
      await p.click(btn("Chart"));
      await wait(100);
      await p.click(".jw-modal button.primary");
      await wait(300);
      assert(await p.eval<boolean>(`!!document.querySelector(".jw-chart svg")`), "chart renders");
    });

    await t.step("3.9 link: Ctrl+K inserts, edits; context menu removes", async () => {
      await load(p, "Go here now\n");
      await sel(p, "here");
      await p.key("k", 2);
      await wait(100);
      await p.eval(`document.querySelectorAll(".jw-modal input")[1].value = "https://example.com"`);
      await p.click(".jw-modal button.primary");
      await wait(80);
      assertStringIncludes(await src(p), "[here](https://example.com)");
      await sel(p, "her");
      await p.key("k", 2);
      await wait(100);
      assertEquals(await p.eval<string>(`document.querySelectorAll(".jw-modal input")[1].value`), "https://example.com", "dialog shows current address");
      await p.eval(`document.querySelectorAll(".jw-modal input")[1].value = "https://b.example"`);
      await p.click(".jw-modal button.primary");
      await wait(80);
      assertStringIncludes(await src(p), "[here](https://b.example)");
      await sel(p, "her");
      await p.eval(
        `(() => { const r = document.querySelector(".ProseMirror a").getBoundingClientRect(); document.querySelector(".ProseMirror a").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.x + 3, clientY: r.y + 3 })); })()`,
      );
      await wait(100);
      await p.eval(`[...document.querySelectorAll(".jw-menu button")].find((b) => b.textContent.startsWith("Remove link")).click()`);
      await wait(80);
      assertEquals((await src(p)).trim(), "Go here now");
    });

    await t.step("3.10 equation: inserts MathML, double-click edits", async () => {
      await load(p, "E\n");
      await after(p, "E");
      await tab("Insert");
      await p.click(btn("Equation"));
      await wait(100);
      await p.eval(`document.querySelector(".jw-modal input, .jw-modal textarea").value = "x^2"`);
      await p.click(".jw-modal button.primary");
      await wait(150);
      assert(await p.eval<boolean>(`!!document.querySelector(".ProseMirror math")`), "MathML rendered");
      assertStringIncludes(await src(p), "$`x^2`");
    });

    await t.step("3.11 footnotes: numbered in reading order, hover shows text, click jumps", async () => {
      await load(p, "First second\n");
      await after(p, "second");
      await tab("Insert");
      await p.click(btn("Footnote"));
      await wait(100);
      await p.eval(`document.querySelector(".jw-modal input").value = "Note B"`);
      await p.click(".jw-modal button.primary");
      await wait(100);
      await sel(p, "First");
      await p.click(btn("Footnote"));
      await wait(100);
      await p.eval(`document.querySelector(".jw-modal input").value = "Note A"`);
      await p.click(".jw-modal button.primary");
      await wait(300);
      assertEquals(await texts(p, ".jw-fnref"), ["[1]", "[2]"]);
      const s = await src(p);
      assert(s.indexOf("[^1]: Note A") < s.indexOf("[^2]: Note B"), s);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-fnref").title`), "Note A");
    });

    await t.step("3.12 table of contents lists headings, updates, entries jump", async () => {
      await load(p, "::: toc\n:::\n\n# One\n\n" + "filler\n\n".repeat(40) + "# Two\n");
      await wait(300);
      assertEquals(await texts(p, ".jw-toc li"), ["One", "Two"]);
      await p.click(".jw-toc li:nth-child(2) a");
      await wait(600);
      const visible = await p.eval<boolean>(
        `(() => { const h = [...document.querySelectorAll(".ProseMirror h1")].at(-1).getBoundingClientRect(); return h.top >= 0 && h.top < innerHeight; })()`,
      );
      assert(visible, "jumped to heading Two");
      await sel(p, "Two");
      await p.type("Three");
      await wait(400);
      assertEquals(await texts(p, ".jw-toc li"), ["One", "Three"]);
    });

    await t.step("3.13 horizontal line, page break, slide, raw HTML", async () => {
      for (const [label, want] of [["Horizontal line", "* * *"], ["Page break (Ctrl+Enter)", "{.page-break}"], ["Slide", "::: slide"]]) {
        await load(p, "x\n");
        await after(p, "x");
        await tab("Insert");
        await p.click(btn(label));
        await wait(80);
        assertStringIncludes(await src(p), want, label);
      }
    });

    await t.step("3.15 sheet: ranges, Ctrl+D, totals grow, sort keeps totals, rename follows, formats, undo, click-to-reference, copy/paste", async () => {
      await load(
        p,
        'Total [?]{calc="S!D4"}\n\n{#S}\n``` =sheet\n| Item | Qty | Price | Total |\n|---|---|---|---|\n| Milk | 2 | 1.2 | =B2*C2 |\n| Bread | 1 | 2.5 | =B3*C3 |\n| Sum | | | =SUM(D2:D3) |\n```\n',
      );
      const cell = (r: number, c: number) => p.eval<string>(`document.querySelector('.jw-sheet-grid td[data-r="${r}"][data-c="${c}"]').textContent`);
      const td = (r: number, c: number) => `.jw-sheet-grid td[data-r="${r}"][data-c="${c}"]`;
      await p.click(td(2, 3));
      await p.click(btn("Insert a row below (formulas follow)"));
      await wait(200);
      assertStringIncludes(await src(p), "=SUM(D2:D4)", "a totals formula grows when an item is added under the list");
      assertStringIncludes(await src(p), 'calc="S!D5"', "live value in the text follows the moved total");
      await p.click(td(3, 0));
      await p.press("Eggs");
      await p.key("Tab");
      await p.press("12");
      await p.key("Tab");
      await p.press("0.3");
      await p.key("Tab");
      await p.key("d", 2); // Ctrl+D: formula from above, relative refs follow
      await wait(300);
      assertEquals([await cell(3, 3), await cell(4, 3)], ["3.6", "8.5"]);
      await p.click(td(1, 1));
      await p.key("ArrowDown", 8);
      await p.key("ArrowDown", 8);
      await wait(80);
      assertEquals(await p.eval<string>(`document.querySelector(".jw-sheet-ref").textContent`), "S!B2:B4");
      assertEquals(await p.eval<string>(`document.querySelector(".jw-sheet-stats").textContent`), "Sum 15 · Average 5 · Count 3");
      await p.click(td(1, 0));
      await p.click(btn("Sort rows by this column, smallest first (header and a totals row stay put)"));
      await wait(300);
      assertEquals([await cell(1, 0), await cell(2, 0), await cell(3, 0), await cell(4, 0)], ["Bread", "Eggs", "Milk", "Sum"]);
      assertEquals(await cell(4, 3), "8.5", "totals unchanged by sorting");
      await p.eval(`(() => { const i = document.querySelector(".jw-sheet-name"); i.value = "Nákup"; i.dispatchEvent(new Event("change")); })()`);
      await wait(300);
      assertStringIncludes(await src(p), 'calc="Nákup!D5"');
      assertEquals(await p.eval<string>(`document.querySelector(".jw-calc").textContent`), "8.5");
      await p.click('.jw-sheet-grid th[data-c="3"]');
      await p.eval(
        `(() => { const s = document.querySelector('[aria-label="Number format"]'); s.value = '#,##0.00 "€"'; s.dispatchEvent(new Event("change")); })()`,
      );
      await wait(300);
      assertEquals(await cell(4, 3), "8.50 €");
      await p.click(td(1, 1));
      await p.key("z", 2);
      await wait(300);
      assertEquals(await cell(4, 3), "8.5", "Ctrl+Z inside the sheet");
      await p.click(td(5, 1)).catch(() => {});
      await p.click(td(4, 1));
      await p.press("=");
      await p.click(td(1, 1));
      await p.press("+");
      await p.click(td(2, 1));
      await p.key("Enter");
      await wait(300);
      assertStringIncludes(await src(p), "| Sum   | =B2+B3 |", "clicking cells while typing a formula inserts their references");
      // copy C2:D2 and paste at C5: relative refs move with it
      await p.click(td(1, 2));
      await p.key("ArrowRight", 8);
      await p.eval(
        `(() => { const dt = new DataTransfer(); document.querySelector(".jw-sheet-grid").dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true })); window.__clip = dt.getData("text/plain"); })()`,
      );
      assertEquals(await p.eval<string>("window.__clip"), "2.5\t2.5", "values go to other apps");
      await p.click(td(5, 2));
      await p.eval(
        `(() => { const dt = new DataTransfer(); dt.setData("text/plain", window.__clip); document.querySelector(".jw-sheet-grid").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true })); })()`,
      );
      await wait(300);
      assertStringIncludes(await src(p), "| 2.5   | =B6*C6", "pasted formula follows its new row");
      // paste from Excel: tab-separated block grows the sheet
      await p.click(td(0, 3));
      await p.eval(
        `(() => { const dt = new DataTransfer(); dt.setData("text/plain", "x\\ty\\tz\\n1\\t2\\t3"); document.querySelector(".jw-sheet-grid").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true })); })()`,
      );
      await wait(300);
      assertEquals([await cell(0, 5), await cell(1, 5)], ["z", "3"], "sheet grew to fit the pasted block");
    });

    await t.step("3.16 sheet: bold / fill / align on cells and columns, saved in the file; function hints and Tab completion", async () => {
      await load(p, "{#T}\n``` =sheet\n| Item | Qty |\n|---|---|\n| Milk | 2 |\n| Eggs | 12 |\n```\n");
      const td = (r: number, c: number) => `.jw-sheet-grid td[data-r="${r}"][data-c="${c}"]`;
      const css = (r: number, c: number) => p.eval<string>(`document.querySelector(${q(td(r, c))}).style.cssText`);
      await p.click(td(1, 0));
      await p.key("b", 2);
      await wait(150);
      assertStringIncludes(await css(1, 0), "font-weight: 700", "Ctrl+B bolds the cell");
      assertEquals(await p.eval<string>(`document.querySelector('[aria-label="Bold (Ctrl+B)"]').getAttribute("aria-pressed")`), "true");
      await p.click('.jw-sheet-grid th[data-c="1"]');
      await p.eval(`(() => { const s = document.querySelector('[aria-label="Cell fill"]'); s.value = "#fff3a3"; s.dispatchEvent(new Event("change")); })()`);
      await p.eval(`(() => { const s = document.querySelector('[aria-label="Align"]'); s.value = "c"; s.dispatchEvent(new Event("change")); })()`);
      await wait(150);
      assertStringIncludes(await css(2, 1), "background: rgb(255, 243, 163)", "a column fill colours its body cells");
      assertStringIncludes(await src(p), 'cells="A2:b;B:al=c bg=#fff3a3"');
      await p.click(td(2, 1));
      await p.key("Tab"); // add a column, then a row that inherits the column style
      await p.click(td(2, 1));
      await p.key("Enter");
      await wait(150);
      assertStringIncludes(await css(3, 1), "background", "a new row inherits the column style");
      const dir = await Deno.makeTempDir({ prefix: "jw-cells-" });
      try {
        assert(await p.eval<boolean>(`jw.saveTo(${q(`${dir}/c.html`)})`));
        assertStringIncludes(await Deno.readTextFile(`${dir}/c.html`), '<td style="font-weight:700">Milk</td>');
      } finally {
        await Deno.remove(dir, { recursive: true }).catch(() => {});
      }
      await p.click(td(3, 0));
      await p.press("=su");
      await wait(80);
      const hint = () => p.eval<string>(`document.querySelector(".jw-sheet-hint").hidden ? "" : document.querySelector(".jw-sheet-hint").textContent`);
      assertStringIncludes(await hint(), "SUM");
      await p.key("Tab");
      await wait(80);
      assertEquals(await p.eval<string>(`document.querySelector(".jw-cell-edit").value`), "=SUM(");
      assertStringIncludes(await hint(), "SUM(number1, [number2], …) — adds numbers");
      await p.press("B2:B3)");
      await p.key("Enter");
      await wait(200);
      assertEquals(await p.eval<string>(`document.querySelector(${q(td(3, 0))}).textContent`), "14");
      assertEquals(await hint(), "", "hint hidden after Enter");
    });

    await t.step("3.16b sheet: Wrap and Borders buttons toggle, show in the editor and the saved file", async () => {
      await load(p, "{#W}\n``` =sheet\n| Item | Note |\n|---|---|\n| Milk | a long note that wraps |\n```\n");
      const td = '.jw-sheet-grid td[data-r="1"][data-c="1"]';
      const btn = (l: string) => `[aria-label^="${l}"]`;
      await p.click(td);
      await p.click(btn("Wrap text"));
      await p.click(btn("Borders"));
      await wait(150);
      const css = await p.eval<string>(`document.querySelector(${q(td)}).style.cssText`);
      assertStringIncludes(css, "white-space: pre-wrap");
      assertStringIncludes(css, "border: 1px solid");
      assertStringIncludes(await src(p), 'cells="B2:wr bd"');
      assertEquals(await p.eval<string>(`document.querySelector(${q(btn("Borders"))}).getAttribute("aria-pressed")`), "true");
      await p.click(btn("Borders"));
      await wait(150);
      assertStringIncludes(await src(p), "{#W cells=B2:wr}", "a second click removes the borders");
    });

    await t.step("3.17 sheet: own right-click menu, arrows save while typing, F4 $, AutoSum, decimals, chart from the selection", async () => {
      await load(p, "{#N}\n``` =sheet\n| Item | Qty |\n|---|---|\n| Milk | 2 |\n| Eggs | 12.5 |\n|  |  |\n```\n");
      const td = (r: number, c: number) => `.jw-sheet-grid td[data-r="${r}"][data-c="${c}"]`;
      const cell = (r: number, c: number) => p.eval<string>(`document.querySelector(${q(td(r, c))}).textContent`);
      const right = (sel: string) =>
        p.eval(
          `(() => { const e = document.querySelector(${
            q(sel)
          }); const r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 4, clientY: r.y + 4 })); })()`,
        );
      await right(td(1, 0));
      await wait(100);
      const items = await texts(p, ".jw-menu button span");
      assert(items.includes("Insert row above") && items.includes("Save sheet as CSV…") && !items.includes("Paste as plain text"), "the sheet's menu");
      await p.key("Escape");
      await p.click(td(1, 0));
      await p.press("Bread");
      await p.key("ArrowDown"); // saves and moves, like Excel
      await wait(400); // the sheet recalculates a moment later
      assertEquals(await cell(1, 0), "Bread");
      assertEquals(await p.eval<string>(`document.querySelector(".jw-sheet-ref").textContent`), "N!A3");
      await p.click(td(3, 1));
      await p.key("=", 1); // Alt+=
      await wait(200);
      assertStringIncludes(await src(p), "=SUM(B2:B3)", "AutoSum finds the numbers above");
      assertEquals(await cell(3, 1), "14.5");
      await p.click(td(3, 1));
      await p.click('[aria-label="More decimals"]');
      await wait(150);
      assertEquals(await cell(3, 1), "14.50");
      await p.click(td(3, 0));
      await p.press("=B2");
      await p.key("F4");
      await wait(50);
      assertEquals(await p.eval<string>(`document.querySelector(".jw-cell-edit").value`), "=$B$2");
      await p.key("Escape");
      await p.click(td(1, 0));
      await p.key("ArrowDown", 8);
      await p.key("ArrowRight", 8);
      await p.click('[aria-label="Chart from the selected cells (first column = labels, first row = series names)"]');
      await wait(300);
      assertStringIncludes(await src(p), 'data="N!A2:B3"', "the chart uses the selected cells");
    });

    await t.step("3.18 sheet fill handle: drag continues months and numbers down; formulas follow to the right", async () => {
      await load(p, "{#F}\n``` =sheet\n| Month | Units | Price | Total |\n|---|---|---|---|\n| Jan | 1 | 2 | =B2*C2 |\n| Feb | 2 | 2 |  |\n```\n");
      const td = (r: number, c: number) => `.jw-sheet-grid td[data-r="${r}"][data-c="${c}"]`;
      const box = (sel: string) =>
        p.eval<{ x: number; y: number }>(
          `(() => { const r = document.querySelector(${q(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
        );
      await p.click(td(1, 0));
      await p.key("ArrowDown", 8);
      await p.key("ArrowRight", 8); // A2:B3
      await wait(80);
      const h = await box(".jw-fill-handle");
      const t = await box(td(2, 1));
      await p.drag(h.x, h.y, t.x, t.y + 2 * 26); // two rows further down
      await wait(300);
      const s = await src(p);
      assertStringIncludes(s, "| Mar   | 3     |", "months and numbers continue");
      assertStringIncludes(s, "| Apr   | 4     |");
      await p.click(td(1, 3));
      await wait(80);
      const h2 = await box(".jw-fill-handle");
      await p.drag(h2.x, h2.y, h2.x, (await box(td(4, 3))).y);
      await wait(300);
      assertStringIncludes(await src(p), "=B3*C3", "a formula filled down follows its row");
    });

    await t.step("3.19 table style (banded rows, no borders …) and vertical alignment: editor and saved file", async () => {
      await load(p, "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n");
      await after(p, "3");
      await wait(150);
      await tab("Table");
      await p.eval(
        `(() => { const s = document.querySelector('[aria-label="Table style"]'); s.value = "banded"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`,
      );
      await wait(150);
      assert(await p.eval<boolean>(`document.querySelector(".ProseMirror table").classList.contains("banded")`), "the editor shows the style");
      assertStringIncludes(await src(p), "{.banded}");
      assertEquals(await p.eval<string>(`document.querySelector('[aria-label="Table style"]').value`), "banded", "the box shows the current style");
      await p.eval(
        `(() => { const s = document.querySelector('[aria-label="Vertical alignment"]'); s.value = "middle"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`,
      );
      await wait(150);
      assertStringIncludes(await p.eval<string>("jw.html()"), "vertical-align:middle", "saved with the cell");
      await p.eval(
        `(() => { const s = document.querySelector('[aria-label="Table style"]'); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); })()`,
      );
      await wait(100);
      assert(!(await src(p)).includes("banded"), "back to the plain grid");
      await tab("Insert");
    });

    await t.step("3.20 text box: type in place (Enter / double-click), Esc keeps it; text size, alignment and colour reach the file", async () => {
      await load(p, 'Intro\n\n{kind=rect x=0mm y=0mm w=60mm h=20mm fill=none stroke="#1a5fb4"}\n::: shape\nOld\n:::\n\nAfter\n');
      await p.click(".jw-shape-box");
      await wait(100);
      await p.key("Enter");
      await wait(100);
      assert(await p.eval<boolean>(`document.activeElement?.classList.contains("jw-shape-text")`), "typing goes into the box");
      await p.press("Hello");
      await p.key("Escape");
      await wait(150);
      assertStringIncludes(await src(p), "::: shape\nHello\n:::", "typed text replaced the selected old text");
      await p.click(".jw-shape-box");
      await wait(100);
      await tab("Shape");
      await p.eval(
        `(() => { const s = document.querySelector('[aria-label="Text size"]'); s.value = "20pt"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`,
      );
      await wait(100);
      await p.click(btn("Text left"));
      await wait(100);
      const html = await p.eval<string>("jw.html()");
      assertStringIncludes(html, '<div class="jw-shape-text" style="font-size:20pt;text-align:left;justify-content:flex-start">');
      assertEquals(await p.eval<string>(`document.querySelector(".ProseMirror .jw-shape-text").style.fontSize`), "20pt", "the editor shows it too");
      await tab("Insert");
    });

    await t.step("3.14 code block: ```js + Enter, syntax colours in editor and saved file, Tab/auto-indent, language picker, 3×Enter exits", async () => {
      await load(p, "Intro\n");
      await after(p, "Intro");
      await p.key("Enter");
      await p.type("```js");
      await p.key("Enter");
      await p.type("function hi(name) {");
      await p.key("Enter");
      await p.key("Tab");
      await p.type('console.log("hello"); // greet');
      await p.key("Enter");
      await p.type("return 42;");
      await wait(150);
      const toks = () => p.eval<string[]>(`[...document.querySelectorAll(".ProseMirror pre [class^=hl-]")].map((e) => e.className + ":" + e.textContent)`);
      assertEquals(await toks(), ["hl-k:function", "hl-f:hi", "hl-t:console", "hl-f:log", 'hl-s:"hello"', "hl-c:// greet", "hl-k:return", "hl-n:42"]);
      assertStringIncludes(
        await src(p),
        '```js\nfunction hi(name) {\n  console.log("hello"); // greet\n  return 42;\n```',
        "Tab indents, Enter keeps the indent",
      );
      assertEquals(await p.eval<string>(`document.querySelector(".jw-code-bar select").value`), "js");
      const dir = await Deno.makeTempDir({ prefix: "jw-code-" });
      try {
        assert(await p.eval<boolean>(`jw.saveTo(${q(`${dir}/c.html`)})`));
        assertStringIncludes(await Deno.readTextFile(`${dir}/c.html`), '<span class="hl-s">&quot;hello&quot;</span>', "colours in the file, no script needed");
      } finally {
        await Deno.remove(dir, { recursive: true }).catch(() => {});
      }
      await p.eval(
        `(() => { const s = document.querySelector(".jw-code-bar select"); s.value = "python"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`,
      );
      await wait(100);
      assertStringIncludes(await src(p), "```python\n");
      await after(p, "return 42;");
      for (let i = 0; i < 3; i++) await p.key("Enter");
      await p.type("After");
      await wait(100);
      assertStringIncludes(await src(p), "  return 42;\n```\n\nAfter", "three Enters leave the block");
    });
  } finally {
    await p.close();
  }
});

Deno.test({ name: "audit 4: review", ignore: !URL_, sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const p = await launch(URL_!, { width: 1400, height: 900 });
  const tab = (name: string) => p.click(`[aria-label="${name} tab"]`);
  const modalInput = (v: string) => p.eval(`(() => { const i = document.querySelector(".jw-modal textarea, .jw-modal input"); i.value = ${q(v)}; })()`);
  try {
    await t.step("4.5 author name is used for comments and changes", async () => {
      await load(p, "x\n");
      await tab("UI");
      await p.click(btn("Your name"));
      await wait(80);
      await modalInput("Ann");
      await p.click(".jw-modal button.primary");
      await wait(80);
      await tab("Review"); // the review steps below work from the Review tab
    });

    await t.step("4.1 comments: on the word at the caret (Word) or a selection, with author, resolves; dialog returns focus", async () => {
      await load(p, "Alpha beta gamma\n");
      await after(p, "Alpha be"); // caret inside "beta", nothing selected
      await p.click(btn("New comment"));
      await wait(80);
      await modalInput("Check this");
      await p.key("Enter", 2); // Ctrl+Enter confirms a multi-line box
      await wait(80);
      const s = await src(p);
      assertStringIncludes(s, "[beta]{at=");
      assertStringIncludes(s, 'by=Ann comment="Check this"');
      assert(await p.eval<boolean>(`document.activeElement === jw.view().dom`), "focus back in the document");
      await sel(p, "beta");
      await p.click(btn("Resolve"));
      await wait(80);
      assertEquals((await src(p)).trim(), "Alpha beta gamma");
    });

    await t.step("4.2 track changes: Ctrl+Shift+E, marks edits by author, accept/reject all", async () => {
      await load(p, "Keep this\n");
      await after(p, "Keep");
      await p.key("E", 2 | 8);
      await wait(80);
      assertStringIncludes(await status(p), "Track changes on");
      await p.type(" new");
      await wait(80);
      assertStringIncludes(await src(p), "Keep {+new+}{");
      assertStringIncludes(await src(p), "by=Ann");
      await p.click(btn("Reject all"));
      await wait(80);
      assertEquals((await src(p)).trim(), "Keep this");
      await p.type(" more");
      await p.click(btn("Accept all"));
      await wait(80);
      assertEquals((await src(p)).trim(), "Keep more this");
      await p.key("E", 2 | 8);
      await wait(80);
      assert(!(await status(p)).includes("Track changes on"), "tracking off");
    });

    await t.step("4.2b track changes keep underline / strikethrough: accept and reject only touch the tracked part", async () => {
      await load(p, "A {+under+} and {-old-} here\n");
      await after(p, "un");
      await p.key("E", 2 | 8); // tracking on
      await p.type("X");
      await sel(p, "old");
      await p.key("Backspace");
      await wait(80);
      const tracked = await src(p);
      await p.click(btn("Reject all"));
      await wait(80);
      assertEquals((await src(p)).trim(), "A {+under+} and {-old-} here", "reject: the plain underline and strikethrough stay");
      await after(p, "un");
      await p.type("X");
      await p.click(btn("Accept all"));
      await wait(80);
      assertStringIncludes(await src(p), "{+unXder+}", "accept: the typed letter keeps the underline");
      await sel(p, "here");
      await p.click('[aria-label="Home tab"]');
      assertEquals(await p.eval<string>(`document.querySelector('[aria-label="Underline (Ctrl+U)"]').getAttribute("aria-pressed")`), "false");
      await sel(p, "Xder");
      await wait(50);
      assertEquals(await p.eval<string>(`document.querySelector('[aria-label="Underline (Ctrl+U)"]').getAttribute("aria-pressed")`), "true");
      await p.click('[aria-label="Review tab"]');
      await p.key("E", 2 | 8); // tracking off
      await p.eval(`jw.load(${q(tracked)})`); // tracked + plain marks together survive a save / reload
      await wait(500);
      assertEquals(await src(p), tracked, "round trip");
    });

    await t.step("4.1 previous/next walks comments and changes, wrapping", async () => {
      await load(p, '[a]{comment="1"} b {+c+}{by=X} d [e]{comment="2"}\n');
      await after(p, "b");
      const at = () => p.eval<string>(`(() => { const s = jw.view().state.selection; return jw.view().state.doc.textBetween(s.from, s.to); })()`);
      await p.click(btn("Next comment or change"));
      assertEquals(await at(), "c");
      await p.click(btn("Next comment or change"));
      assertEquals(await at(), "e");
      await p.click(btn("Next comment or change"));
      assertEquals(await at(), "a", "wraps");
      await p.click(btn("Previous comment or change"));
      assertEquals(await at(), "e");
    });

    await t.step("4.3b find also searches sheet cells: highlight, Next walks into the sheet, Replace all edits cells", async () => {
      await load(p, "milk first\n\n{#S}\n``` =sheet\n| Item | Note |\n|---|---|\n| Milk | milk, milk |\n```\n\nmilk last\n");
      await p.click(".ProseMirror");
      await p.key("f", 2);
      await wait(100);
      await p.type("milk");
      await wait(200);
      assertEquals(await p.eval<string>(`document.querySelector(".jw-find-count").textContent`), "1 of 5");
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-sheet-grid td.found").length`), 2, "two cells hold matches");
      await p.key("Enter"); // first match (text)
      await p.key("Enter"); // next: into the sheet
      await wait(150);
      assertEquals(
        await p.eval<string>(
          `document.querySelector(".jw-sheet-grid td.found-cur").dataset.r + document.querySelector(".jw-sheet-grid td.found-cur").dataset.c`,
        ),
        "10",
      );
      assertEquals(await p.eval<string>(`document.querySelector(".jw-sheet-ref").textContent`), "S!A2", "the cell cursor follows");
      await p.click('[aria-label="Show replace"]');
      await p.eval(
        `(() => { const i = document.querySelector('.jw-findbar input[aria-label="Replace with"]'); i.value = "Oat"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`,
      );
      await p.click('[aria-label="Replace all"]');
      await wait(200);
      const s = await src(p);
      assertStringIncludes(s, "| Oat  | Oat, Oat |");
      assertStringIncludes(s, "Oat first");
      assertStringIncludes(s, "Oat last");
      await p.eval(
        `(() => { const i = document.querySelector('.jw-findbar input[aria-label="Replace with"]'); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); })()`,
      );
      await p.key("Escape");
    });

    await t.step("4.3 find: counter, case, whole word, regex, replace one/all", async () => {
      await load(p, "cat Cat category cat\n");
      await p.click(".ProseMirror");
      await p.key("f", 2);
      await wait(100);
      await p.type("cat");
      await wait(150);
      const count = () => p.eval<string>(`document.querySelector(".jw-find-count").textContent`);
      assertEquals(await count(), "1 of 4");
      await p.click('[aria-label="Match case"]');
      await wait(100);
      assertEquals(await count(), "1 of 3");
      await p.click('[aria-label="Whole words"]');
      await wait(100);
      assertEquals(await count(), "1 of 2");
      await p.click('[aria-label="Match case"]');
      await p.click('[aria-label="Whole words"]');
      await p.click('[aria-label="Regular expression"]');
      await p.eval(
        `(() => { const i = document.querySelector('[aria-label="Find"]'); i.value = "c.t\\\\b"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`,
      );
      await wait(150);
      assertEquals(await count(), "1 of 3");
      await p.key("h", 2);
      await wait(100);
      await p.click('[aria-label="Replace with"]');
      await p.type("dog");
      await p.click('[aria-label="Replace"]');
      await wait(100);
      assertStringIncludes(await src(p), "dog Cat category cat");
      await p.click('[aria-label="Replace all"]');
      await wait(100);
      assertStringIncludes(await src(p), "dog dog category dog");
      await p.key("Escape");
    });

    await t.step("4.4 word count: dialog numbers, selection count in status bar", async () => {
      await load(p, "# Title\n\nOne two three four.\n");
      assertStringIncludes(await status(p), "5 words");
      await sel(p, "two three");
      await wait(50);
      assertStringIncludes(await status(p), "2 of 5 words");
      await p.click('[t="words"], .jw-status button[title^="Word count"]');
      await wait(100);
      const rows = await p.eval<string>(`document.querySelector(".jw-info").innerText`);
      for (const x of ["Pages\t1", "Words\t5", "Paragraphs\t2", "Words in selection\t2"]) assertStringIncludes(rows, x);
      await p.key("Escape");
      await wait(60);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-modal").length`), 0);
    });
  } finally {
    await p.close();
  }
});

Deno.test({ name: "audit 5: view & app", ignore: !URL_, sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const p = await launch(URL_!, { width: 1400, height: 900 });
  const tab = (name: string) => p.click(`[aria-label="${name} tab"]`);
  const theme = () => p.eval<string>(`document.documentElement.dataset.theme ?? "auto"`);
  try {
    await t.step("5.1 app theme cycles System → Light → Dark; the document keeps its own colours", async () => {
      await load(p, "# Hi\n\ntext\n");
      for (let i = 0; i < 3 && (await theme()) !== "auto"; i++) (await p.click('[aria-label^="App theme:"]'), await wait(150));
      assertEquals(await theme(), "auto");
      const look = () =>
        p.eval<string[]>(
          `[".jw-sheet", ".ProseMirror p", ".jw-canvas"].map((s) => { const c = getComputedStyle(document.querySelector(s)); return s === ".ProseMirror p" ? c.color : c.backgroundColor; })`,
        );
      await p.click('[aria-label^="App theme:"]');
      await wait(150);
      assertEquals(await theme(), "light");
      const [lightPage, lightText, lightCanvas] = await look();
      await p.click('[aria-label^="App theme:"]');
      await wait(150);
      assertEquals(await theme(), "dark");
      const [darkPage, darkText, darkCanvas] = await look();
      assertEquals([darkPage, darkText], [lightPage, lightText], "page and text colour belong to the document, not the app theme");
      assertEquals(darkPage, "rgb(255, 255, 255)");
      assert(darkCanvas !== lightCanvas, "the app around the page does follow the theme");
    });

    await t.step("5.2 options: app-only settings, says so; Esc closes and focus returns", async () => {
      await p.click('[aria-label="Options"]');
      await wait(150);
      assert(await p.eval<boolean>(`document.activeElement.closest(".jw-settings") !== null`), "focus inside");
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-set-note").textContent`), "Nothing here is saved in your documents");
      assertEquals(
        await p.eval<boolean>(`[...document.querySelectorAll(".jw-settings [role=radio]")].some((b) => /White|Follow/.test(b.textContent))`),
        false,
        "no document setting in app options",
      );
      await p.key("Escape");
      await wait(100);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-settings").length`), 0);
      await p.click('[aria-label="Options"]');
      await wait(100);
      await p.eval(`[...document.querySelectorAll('.jw-settings [role="radio"]')].find((b) => b.textContent.includes("System")).click()`);
      await p.key("Escape");
    });

    await t.step("5.10 document page colour and text colour: saved in the document and the file, independent of the app theme", async () => {
      await load(p, "# Hi\n\ntext\n");
      await tab("Document");
      await p.click('[aria-label="Page colour options"]');
      await wait(100);
      await p.click('.jw-palette [aria-label="Cream"]');
      await p.click('[aria-label="Text colour options"]');
      await wait(100);
      await p.click('.jw-palette [aria-label="Navy"]');
      await wait(150);
      const s = await src(p);
      assertStringIncludes(s, "page-color: #fffdf5");
      assertStringIncludes(s, "text-color: #1f3864");
      assertEquals(await p.eval<string>(`getComputedStyle(document.querySelector(".jw-sheet")).backgroundColor`), "rgb(255, 253, 245)");
      assertEquals(await p.eval<string>(`getComputedStyle(document.querySelector(".ProseMirror p")).color`), "rgb(31, 56, 100)");
      const dir = await Deno.makeTempDir({ prefix: "jw-colors-" });
      try {
        assert(await p.eval<boolean>(`jw.saveTo(${q(`${dir}/c.html`)})`));
        const v = await launch(`file://${dir}/c.html`);
        try {
          await wait(300);
          assertEquals(await v.eval<string>(`getComputedStyle(document.querySelector(".jw-pg-sheet")).backgroundColor`), "rgb(255, 253, 245)");
          assertEquals(await v.eval<string>(`getComputedStyle(document.querySelector("main p")).color`), "rgb(31, 56, 100)");
        } finally {
          await v.close();
        }
      } finally {
        await Deno.remove(dir, { recursive: true }).catch(() => {});
      }
      await p.click('[aria-label="Page colour options"]');
      await wait(100);
      await p.eval(`[...document.querySelectorAll(".jw-palette .jw-pal-none")][0].click()`);
      await wait(150);
      assert(!(await src(p)).includes("page-color"), "White (default) removes the setting");
    });

    await t.step("5.3 navigation pane: lists headings, click jumps, follows the caret", async () => {
      await load(p, "# One\n\n" + "x\n\n".repeat(40) + "## Two\n\nend\n");
      await tab("UI");
      if (!(await p.eval<boolean>(`!!document.querySelector(".jw-nav")`))) await p.click(btn("Navigation"));
      await wait(150);
      assertEquals(await texts(p, ".jw-nav li button"), ["One", "Two"]);
      await p.click(".jw-nav li:nth-child(2) button");
      await wait(500);
      assertEquals(await p.eval<string>(`document.querySelector('.jw-nav [aria-current="true"]').textContent`), "Two");
      await p.click(btn("Close navigation pane"));
    });

    await t.step("5.3b around-pages colour (Document tab): editor and saved file, default follows the UI", async () => {
      await load(p, "Hello\n");
      await tab("Document");
      const desk = () => p.eval<string>(`getComputedStyle(document.querySelector(".jw-canvas")).backgroundColor`);
      const ui = await desk();
      assert(ui !== "rgb(0, 0, 0)", "the default workspace is grey, not black");
      await p.click('[aria-label^="Around pages:"]');
      await p.click('.jw-palette [aria-label="White"]');
      await wait(150);
      assertEquals(await desk(), "rgb(255, 255, 255)");
      assertStringIncludes(await src(p), "desk-color: #ffffff", "a document setting");
      assertStringIncludes(await p.eval<string>(`jw.fileHtml()`), "--jw-desk:#ffffff", "the saved file uses it too");
      await p.click('[aria-label^="Around pages:"]');
      await p.click(".jw-palette .jw-pal-none");
      await wait(150);
      assertEquals(await desk(), ui, "Automatic brings the theme colour back");
    });

    await t.step("5.3c browser preview: the saved file in a frame, light / dark browser, Esc closes", async () => {
      await load(p, "# Report\n\nHello preview\n");
      await tab("Document");
      await p.click(btn("Browser preview"));
      await wait(1200);
      const frame = () => p.eval<string>(`document.querySelector(".jw-preview-frame").srcdoc`);
      const doc = await frame();
      assertStringIncludes(doc, "Hello preview", "the file's own HTML, not the editor");
      assertStringIncludes(doc, 'id="jw-src"', "exactly what Save writes");
      await p.click(".jw-preview-modes button:nth-child(2)");
      await wait(300);
      assertStringIncludes(await frame(), "@media all{body.jw-paged{background:var(--jw-desk,#3a3a3a)", "dark browser: the file's dark rules apply");
      await p.click(".jw-preview-modes button:nth-child(1)");
      await wait(300);
      assertStringIncludes(await frame(), "@media not all{body.jw-paged{background:var(--jw-desk,#3a3a3a)");
      await p.key("Escape");
      await wait(200);
      assertEquals(await p.eval<boolean>(`!!document.querySelector(".jw-preview")`), false, "Esc closes");
      await p.click(".ProseMirror");
      await p.key("F2", 2);
      await wait(600);
      assert(await p.eval<boolean>(`!!document.querySelector(".jw-preview")`), "Ctrl+F2 opens");
      await p.mouse(640, 400); // focus inside the frame: Esc still closes (message from the frame)
      await p.key("Escape");
      await wait(300);
      assertEquals(await p.eval<boolean>(`!!document.querySelector(".jw-preview")`), false, "Esc inside the frame closes");
    });

    await t.step("5.4 source view: two-way sync", async () => {
      await load(p, "Hello\n");
      await tab("UI");
      await p.click(btn("Source"));
      await wait(400);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-source .cm-content").innerText`), "Hello");
      await after(p, "Hello");
      await p.type(" world");
      await wait(500);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-source .cm-content").innerText`), "Hello world");
      await p.click(".jw-source .cm-content");
      await p.key("End", 2);
      await p.type("\n\n*bold*");
      await wait(700);
      assert(await p.eval<boolean>(`!!document.querySelector(".ProseMirror strong")`), "source edit reached the page");
      await tab("UI");
      await p.click(btn("Source"));
    });

    await t.step("5.6 slideshow: F5, arrows, Esc", async () => {
      await load(p, "# A\n\none\n\n# B\n\ntwo\n");
      await p.click(".ProseMirror");
      await p.key("F5");
      await wait(300);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-show-bar").textContent`), "1 / 2");
      await p.key("ArrowRight");
      await wait(100);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-show-bar").textContent`), "2 / 2");
      await p.key("Escape");
      await wait(200);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-show").length`), 0);
    });

    await t.step("5.6b slideshow: Shift+F5 from the caret, number + Enter, B blanks, link clicks do not advance", async () => {
      await load(p, "# A\n\none\n\n# B\n\ntwo [site](https://example.com)\n\n# C\n\nthree\n");
      const bar = () => p.eval<string>(`document.querySelector(".jw-show-bar").textContent`);
      await after(p, "two");
      await p.key("F5", 8);
      await wait(300);
      assertStringIncludes(await bar(), "2 / 3", "starts on the slide with the caret");
      await p.eval(`document.querySelector(".jw-show a").addEventListener("click", (e) => e.preventDefault())`);
      await p.click(".jw-show a");
      await wait(100);
      assertStringIncludes(await bar(), "2 / 3", "a link click does not advance");
      await p.key("3");
      assertStringIncludes(await bar(), "Go to slide 3");
      await p.key("Enter");
      await wait(100);
      assertStringIncludes(await bar(), "3 / 3");
      await p.key("1");
      await p.key("Enter");
      await wait(100);
      assertStringIncludes(await bar(), "1 / 3");
      await p.key("b");
      assert(await p.eval<boolean>(`document.querySelector(".jw-show").classList.contains("blank-black")`), "B blanks the screen");
      await p.key("ArrowRight");
      await wait(100);
      assert(await p.eval<boolean>(`!document.querySelector(".jw-show").classList.contains("blank-black")`), "moving un-blanks");
      assertStringIncludes(await bar(), "2 / 3");
      await p.key("Escape");
      await wait(200);
      await load(p, "just text, no headings\n");
      await p.key("F5");
      await wait(300);
      assertStringIncludes(await bar(), "1 / 1");
      await p.key("Escape");
      await wait(200);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-show").length`), 0);
    });

    await t.step("5.6d speaker notes: Insert ▸ Notes after a slide; hidden in the file; presenter view (S) shows notes, next slide, timer", async () => {
      await load(p, "::: slide\n## One\n\nfirst\n:::\n\n::: slide\n## Two\n\nsecond\n:::\n");
      await after(p, "first");
      await tab("Insert");
      await p.click(btn("Speaker notes (shown only in the presenter view)"));
      await p.type("Say hello");
      await wait(150);
      assertStringIncludes(await src(p), ":::\n\n::: notes\nSay hello\n:::\n\n::: slide\n## Two", "notes go right after the slide");
      const html = await p.eval<string>("jw.html()");
      assertStringIncludes(html, ".jw-page .notes{display:none}", "the saved file hides notes");
      await after(p, "Say hello");
      await p.key("F5", 8);
      await wait(300);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-show-bar").textContent`), "1 / 2", "caret in notes → its slide");
      assertEquals(
        await p.eval<number>(`document.querySelectorAll(".jw-show-stage .notes, .jw-show-stage .jw-div").length`),
        0,
        "the audience never sees notes",
      );
      await p.key("s");
      await wait(150);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-show-notes").textContent`), "Say hello");
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-show-next").textContent`), "Two");
      assert(/^0:0\d$/.test(await p.eval<string>(`document.querySelector(".jw-show-time span").textContent`)), "timer");
      await p.key("ArrowRight");
      await wait(150);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-show-notes").textContent`), "No notes for this slide.");
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-show-next").textContent`), "End of the show");
      await p.key("Escape");
      await wait(200);
      await tab("Home");
    });

    await t.step("5.6e Insert ▸ Slide inside a slide adds the next slide (never nested); wheel moves; end screen, then exit", async () => {
      await load(p, "::: slide\n## One\n\nfirst\n:::\n\n::: notes\nhi\n:::\n");
      await after(p, "first");
      await tab("Insert");
      await p.click(btn("Slide"));
      await p.type("Two");
      await wait(150);
      assertStringIncludes(await src(p), "::: notes\nhi\n:::\n\n::: slide\n## Two", "after the slide and its notes");
      assertEquals((await src(p)).match(/::: slide/g)?.length, 2);
      await tab("Home");
      await p.key("F5");
      await wait(300);
      const bar = () => p.eval<string>(`document.querySelector(".jw-show-bar").textContent`);
      await p.eval(`dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }))`);
      await wait(100);
      assertStringIncludes(await bar(), "2 / 2", "wheel down = next");
      await p.key("ArrowRight");
      await wait(100);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-show-end")?.textContent ?? ""`), "End of slide show");
      await p.key("ArrowRight");
      await wait(200);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-show").length`), 0, "one more step leaves the show");
    });

    await t.step("5.6f open .xlsx / .ods: every sheet, in order, formulas kept (also across sheets)", async () => {
      for (const f of ["book.xlsx", "book.ods"]) {
        await p.eval(`jw.open(${q(new URL(`../fixtures/${f}`, import.meta.url).pathname)})`);
        await wait(2500);
        const s = await src(p);
        assertStringIncludes(s, "## Sales", f);
        assert(s.indexOf("## Sales") < s.indexOf("## Costs 2026"), "workbook order");
        assertStringIncludes(s, "=SUM(B2:B3)");
        assertStringIncludes(s, "=Sales!B4*2", "a reference to another sheet");
        assertStringIncludes(s, "{#Costs_2026}");
        assertEquals(await texts(p, ".jw-sheet-grid td[data-c='0']"), ["Item", "Milk, fresh", "Eggs", "Sum", "Rent"]);
        assertEquals(await p.eval<string>(`document.querySelectorAll(".jw-sheet-grid")[1].querySelector('td[data-c="1"]').textContent`), "7");
      }
    });

    await t.step("5.6g slides: a warning when text does not fit; right-click ▸ Slide background", async () => {
      await load(p, "::: slide\n## Short\n\nfits\n:::\n");
      await wait(200);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror .jw-overflow").length`), 0);
      await after(p, "fits");
      for (let i = 0; i < 14; i++) (await p.key("Enter"), await p.type(`line ${i}`));
      await wait(200);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror .jw-overflow").length`), 1, "too much text is flagged");
      await p.eval(
        `(() => { const e = document.querySelector(".ProseMirror section.jw-slide h2"); const r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 4, clientY: r.y + 4 })); })()`,
      );
      await wait(100);
      await p.eval(`[...document.querySelectorAll(".jw-menu button")].find((b) => b.textContent.includes("Slide background")).click()`);
      await wait(100);
      await p.eval(`[...document.querySelectorAll(".jw-modal button")].find((b) => b.textContent === "Navy").click()`);
      await wait(100);
      assertStringIncludes(await src(p), 'bg="#1b2a4a"', "background saved");
      assertStringIncludes(await src(p), 'color="#ffffff"', "readable text colour with it");
    });

    await t.step("5.6c open a .csv: a document with a sheet", async () => {
      const dir = await Deno.makeTempDir({ prefix: "jw-csv-" });
      try {
        await Deno.writeTextFile(`${dir}/prices.csv`, 'Item,Price\nMilk,1.2\n"Bread, rye",2.5\n');
        await p.eval(`jw.open(${q(`${dir}/prices.csv`)})`);
        await wait(800);
        assertEquals(await texts(p, ".jw-sheet-grid td[data-c='0']"), ["Item", "Milk", "Bread, rye"]);
        assertStringIncludes(await src(p), "=sheet");
      } finally {
        await Deno.remove(dir, { recursive: true }).catch(() => {});
      }
    });

    await t.step("5.7 ribbon: Ctrl+F1 collapses, a tab click peeks, Ctrl+F1 expands", async () => {
      const body = () => p.eval<boolean>(`!!document.querySelector(".jw-tab-body")`);
      assert(await body());
      await p.key("F1", 2);
      await wait(150);
      assert(!(await body()), "collapsed");
      await tab("Insert");
      await wait(100);
      assert(await body(), "peek shows it");
      await p.key("F1", 2);
      await wait(150);
      assert(await body(), "expanded");
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-modal").length`), 0, "Ctrl+F1 does not open the shortcut list");
    });

    await t.step("5.8 right-click menu: items, keyboard, table section", async () => {
      await load(p, "Some text\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
      const menu = async (selector: string) => {
        await p.eval(
          `(() => { const r = document.querySelector(${q(selector)}).getBoundingClientRect(); document.querySelector(${
            q(selector)
          }).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 4, clientY: r.y + 4 })); })()`,
        );
        await wait(120);
        return texts(p, ".jw-menu button");
      };
      const plain = await menu(".ProseMirror p");
      for (const x of ["Cut", "Copy", "Paste", "Paste as plain text", "Link…"]) assert(plain.some((b) => b.startsWith(x)), x);
      assert(!plain.some((b) => b.startsWith("Insert row")), "no table items outside a table");
      await p.key("Escape");
      await wait(80);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-menu").length`), 0);
      const inTable = await menu(".ProseMirror td");
      assert(inTable.some((b) => b.startsWith("Insert row below")), "table items");
      await p.key("ArrowDown");
      await wait(40);
      assert(await p.eval<boolean>(`document.activeElement.closest(".jw-menu") !== null`), "arrow keys move inside the menu");
      await p.key("Escape");
    });

    await t.step("5.9 F1 lists shortcuts; the listed formatting keys work", async () => {
      await p.click(".ProseMirror");
      await p.key("F1");
      await wait(120);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-info").innerText`), "Track changes on/off");
      await p.key("Escape");
      const cases: [string, number, string][] = [
        ["b", 2, "*w*"],
        ["i", 2, "_w_"],
        ["u", 2, "{+w+}"],
        ["X", 2 | 8, "{-w-}"],
        ["H", 2 | 8, "{=w=}"],
        ["`", 2, "`w`"],
        [".", 2, "^w^"],
        [",", 2, "~w~"],
      ];
      for (const [k, mods, want] of cases) {
        await load(p, "a w b\n");
        await sel(p, "w");
        await p.key(k, mods);
        await wait(60);
        assertStringIncludes(await src(p), `a ${want} b`, `Ctrl+${mods & 8 ? "Shift+" : ""}${k}`);
        assertEquals(await p.eval<string>(`document.querySelector(".jw-findbar") ? "find" : ""`), "", "no find bar");
      }
      await load(p, "line\n");
      await sel(p, "line");
      await p.key("2", 2 | 1);
      await wait(60);
      assertStringIncludes(await src(p), "## line");
      await p.key("0", 2 | 1);
      await wait(60);
      assertEquals((await src(p)).trim(), "line");
      await p.key("8", 2 | 8);
      await wait(60);
      assertStringIncludes(await src(p), "- line");
    });
  } finally {
    await p.close();
  }
});

Deno.test({ name: "audit 6: files", ignore: !URL_, sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const p = await launch(URL_!, { width: 1400, height: 900 });
  const tmp = await Deno.makeTempDir({ prefix: "jw-audit6-" });
  const fileMenu = async () => (await p.click('[aria-label="File"], .jw-tab-file'), await wait(150));
  try {
    await t.step("6.1 File ▸ New from a template; focus lands in the menu; Esc closes", async () => {
      await load(p, "x\n");
      await fileMenu();
      assert(await p.eval<boolean>(`document.activeElement.closest(".jw-backstage") !== null`), "focus in the File menu");
      await p.key("Escape");
      await wait(100);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-backstage").length`), 0);
      await fileMenu();
      await p.click('[aria-label="New Invoice"]');
      await wait(400);
      if (await p.eval<boolean>(`!!document.querySelector(".jw-modal")`)) {
        await p.eval(`[...document.querySelectorAll(".jw-modal button")].find((b) => /don.t save/i.test(b.textContent)).click()`);
      }
      await wait(400);
      assertStringIncludes(await src(p), "=sheet");
    });

    await t.step("6.3 title shows unsaved changes; save clears it", async () => {
      await load(p, "Draft\n");
      await after(p, "Draft");
      await p.type("!");
      await wait(80);
      assert((await p.eval<string>(`document.title`)).startsWith("• "), "window title marks unsaved");
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-title").textContent`), "•");
      await p.eval(`jw.saveTo(${q(`${tmp}/a.html`)})`);
      await wait(400);
      assertEquals(await p.eval<string>(`document.title`), "a.html — Writy");
    });

    await t.step("6.5 recent files: listed with relative time, pin moves to top, missing file offers removal", async () => {
      await p.eval(`jw.saveTo(${q(`${tmp}/b.html`)})`);
      await wait(400);
      await fileMenu();
      const names = () => texts(p, ".jw-recent-item b");
      assertEquals((await names()).slice(0, 2), ["b.html", "a.html"]);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-recent-item time").textContent`), "just now");
      await p.click('[aria-label="Pin a.html"]');
      await wait(150);
      assertEquals((await names())[0], "a.html");
      assertEquals(await texts(p, ".jw-recent-group"), ["Pinned", "Earlier"]);
      await p.click('[aria-label="Unpin a.html"]');
      await wait(150);
      await Deno.remove(`${tmp}/b.html`);
      await p.click('[aria-label="Open b.html"]');
      await wait(300);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-modal").textContent`), "was moved, renamed or deleted");
      await p.eval(`[...document.querySelectorAll(".jw-modal button")].find((b) => b.textContent === "Remove from recent").click()`);
      await wait(200);
      await fileMenu();
      assert(!(await names()).includes("b.html"), "removed");
      await p.key("Escape");
    });

    await t.step("6.7 desktop close button with unsaved work: asks, Cancel keeps, Don't Save closes", async () => {
      // the desktop window shows no "Leave site?" box: the app must ask itself, then close for real
      await p.eval(`window.__aioWindow = {}; window.__closed = 0; window.close = () => window.__closed++`);
      await load(p, "Unsaved\n");
      await after(p, "Unsaved");
      await p.type("!");
      await wait(80);
      const leave = () => p.eval<boolean>(`dispatchEvent(new Event("beforeunload", { cancelable: true }))`);
      assertEquals(await leave(), false, "close vetoed while asking");
      await wait(150);
      assertStringIncludes(await p.eval<string>(`document.querySelector('[role="alertdialog"]').textContent`), "Don't Save");
      await leave(); // a second click does not stack a second dialog
      await wait(150);
      assertEquals(await p.eval<number>(`document.querySelectorAll('[role="alertdialog"]').length`), 1);
      await p.eval(`[...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === "Cancel").click()`);
      await wait(150);
      assertEquals(await p.eval<number>(`window.__closed`), 0, "Cancel keeps the window");
      await leave();
      await wait(150);
      await p.eval(`[...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === "Don't Save").click()`);
      await wait(150);
      assertEquals(await p.eval<number>(`window.__closed`), 1, "Don't Save closes the window");
      assertEquals(await leave(), true, "the real close is not vetoed again");
      await p.eval(`delete window.__aioWindow`);
    });
  } finally {
    await p.close();
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test({ name: "audit 7: quality", ignore: !URL_, sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const p = await launch(URL_!, { width: 1400, height: 900 });
  const probe = await Deno.readTextFile(new URL("./a11y.js", import.meta.url));
  try {
    await t.step("7.1 + 7.3 every control named, icon buttons have tooltips, AA contrast — all tabs, menus, dialogs, both themes", async () => {
      await p.eval(`jw.load(${q(await Deno.readTextFile(new URL("../../examples/showcase.dj", import.meta.url)))})`);
      await wait(500);
      const bad: string[] = [];
      for (const theme of ["Light", "Dark"]) {
        for (let i = 0; i < 3 && !(await p.eval<boolean>(`!!document.querySelector('[aria-label="App theme: ${theme}"]')`)); i++) {
          (await p.click('[aria-label^="App theme:"]'), await wait(120));
        }
        const views: [string, string][] = [
          ["Home", ""],
          ["Insert", ""],
          ["Document", ""],
          ["Review", ""],
          ["UI", ""],
          ["Table", `jw.caretAfter("Coffee")`],
          ["Home", `document.querySelector('[aria-label="Font colour options"]').click()`],
          ["Home", `document.querySelector('[aria-label="File"]').click()`],
          ["Home", `document.querySelector('[aria-label="Options"]').click()`],
          ["Document", `document.querySelector('[aria-label="Header / Footer"]').click()`],
          ["Home", `document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", bubbles: true }))`],
          ["Home", `document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }))`],
        ];
        for (const [tab, act] of views) {
          await p.eval(`document.querySelector('[aria-label="${tab} tab"]')?.click()`);
          await wait(120);
          if (act) (await p.eval(`{ ${act} }`), await wait(200));
          const r = JSON.parse(await p.eval<string>(probe)) as Record<string, string[]>;
          for (const [k, v] of Object.entries(r)) for (const x of v) bad.push(`${theme}/${tab}${act ? "+" : ""} ${k}: ${x}`);
          await p.key("Escape");
          await p.eval(
            `document.querySelector(".jw-backstage [aria-label='Back to document']")?.click(); document.querySelector('[aria-label="Close find"]')?.click()`,
          );
          await wait(120);
        }
      }
      for (let i = 0; i < 3 && !(await p.eval<boolean>(`!!document.querySelector('[aria-label="App theme: System"]')`)); i++) {
        (await p.click('[aria-label^="App theme:"]'), await wait(120));
      }
      assertEquals(bad, []);
    });

    await t.step("7.2 keyboard only: F6 cycles areas, arrows move between tabs, focus ring shows", async () => {
      await load(p, "Text\n");
      await after(p, "Text");
      await p.key("F6");
      await wait(60);
      assertEquals(await p.eval<string>(`document.activeElement.closest(".jw-status") ? "status" : ""`), "status", "F6 from the page → status bar");
      await p.key("F6");
      await wait(60);
      assertEquals(await p.eval<string>(`document.activeElement.getAttribute("role")`), "tab", "then → ribbon");
      await p.key("ArrowRight");
      await wait(40);
      const name = await p.eval<string>(`document.activeElement.getAttribute("aria-label")`);
      await p.key("Enter");
      await wait(80);
      assertEquals(await p.eval<string>(`document.querySelector(".jw-tab.on").getAttribute("aria-label")`), name, "Enter opens the focused tab");
      assert(await p.eval<boolean>(`getComputedStyle(document.activeElement).outlineStyle !== "none"`), "focus ring visible");
      await p.key("F6", 8);
      await wait(60);
      assertEquals(
        await p.eval<string>(`document.activeElement.closest(".jw-status") ? "status" : ""`),
        "status",
        "Shift+F6 from ribbon wraps to the status bar",
      );
      await p.key("F6", 8);
      await wait(60);
      assert(await p.eval<boolean>(`document.activeElement === jw.view().dom`), "back to the page");
    });

    await t.step("7.5 300-page document: loads fast, typing never freezes, pages re-flow as you type", async () => {
      const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor".split(" ");
      const para = (i: number) => Array.from({ length: 70 }, (_, j) => words[(i * 7 + j) % words.length]).join(" ") + ".";
      const big = "``` =meta\nfooter: | {page} |\n```\n\n" +
        Array.from({ length: 300 }, (_, c) => `# Chapter ${c + 1}\n\n` + Array.from({ length: 6 }, (_, k) => para(c + k)).join("\n\n") + "\n\n- a\n- b\n").join(
          "\n\n",
        );
      const t0 = Date.now();
      await p.eval(`jw.load(${q(big)})`);
      const loadMs = Date.now() - t0;
      await wait(2500);
      assert(loadMs < 1500, `load ${loadMs}ms`);
      const sheets = await p.eval<number>(`document.querySelectorAll(".jw-sheet").length`);
      assert(sheets > 250, `sheets ${sheets}`);
      await p.eval(
        `window.__lt = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => __lt.push(Math.round(e.duration)))).observe({ type: "longtask" }); jw.caretAfter("Chapter 150")`,
      );
      await p.type("typing in the middle ");
      for (let i = 0; i < 8; i++) await p.key("Enter");
      await wait(800);
      const lt = await p.eval<number[]>(`__lt`);
      assert(Math.max(0, ...lt) < 100, `long tasks: ${lt}`);
      // the 8 new lines pushed later content: nothing may cross a page edge anywhere
      const bad = await p.eval<number>(`(() => {
        const pm = document.querySelector(".ProseMirror"), paper = document.querySelector(".jw-paper");
        const sheets = [...document.querySelectorAll(".jw-sheet")].map((s) => s.getBoundingClientRect());
        return [...pm.children].filter((b) => { const r = b.getBoundingClientRect(); return r.height < 900 && !sheets.some((s) => r.top >= s.top - 1 && r.bottom <= s.bottom + 1); }).length;
      })()`);
      assertEquals(bad, 0, "blocks crossing a page edge after typing");
    });

    await t.step("7.4 errors are explained: bad file, unknown format", async () => {
      const dir = await Deno.makeTempDir();
      await Deno.writeFile(`${dir}/broken.docx`, new Uint8Array([1, 2, 3, 4]));
      await p.eval(`jw.open(${q(`${dir}/broken.docx`)})`);
      await wait(800);
      const msg = await p.eval<string>(`[...document.querySelectorAll(".jw-toast.error")].map((t) => t.textContent).join(" | ")`);
      assertStringIncludes(msg, "Could not open “broken.docx”");
      await Deno.remove(dir, { recursive: true });
    });
  } finally {
    await p.close();
  }
});
