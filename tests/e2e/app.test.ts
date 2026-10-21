// End-to-end: drives the running app in headless Chromium.
// Run: am start --client=server-only, then JW_URL=http://localhost:<port> deno test -A tests/e2e/
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { launch, type Page } from "./cdp.ts";

const URL_ = Deno.env.get("JW_URL");
const CTRL = 2;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const src = (p: Page) => p.eval<string>("jw.source()");
const fixture = (n: string) => new URL(`../../core/tests/fixtures/${n}`, import.meta.url).pathname;

Deno.test({ name: "e2e: write, format, tables, sheets, save, reopen, import", ignore: !URL_, sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const p = await launch(URL_!);
  const tmp = await Deno.makeTempDir({ prefix: "jw-e2e-" });
  try {
    await t.step("typing with autoformat and shortcuts", async () => {
      await p.eval(`jw.load("")`);
      await p.click(".ProseMirror");
      await p.type("# My Report");
      await p.key("Enter");
      await p.type("Plain and ");
      await p.key("b", CTRL);
      await p.type("bold");
      await p.key("b", CTRL);
      await p.type(' text with "quotes".');
      await p.key("Enter");
      await p.type("- first");
      await p.key("Enter");
      await p.type("second");
      await wait(100);
      const s = await src(p);
      assertStringIncludes(s, "# My Report");
      assertStringIncludes(s, "Plain and *bold* text with “quotes”.");
      assertStringIncludes(s, "- first\n- second");
    });

    await t.step("ribbon: insert table through the dialog and type in it", async () => {
      await p.key("Enter");
      await p.key("Enter"); // leave the list
      await p.click('[aria-label="Insert tab"]');
      await p.click('[aria-label="Table"]');
      await wait(100);
      await p.click('.jw-tgrid [data-r="3"][data-c="3"]');
      await wait(100);
      await p.type("Name");
      await p.key("Tab");
      await p.type("Qty");
      const s = await src(p);
      assertStringIncludes(s, "| Name");
      assertStringIncludes(s, "| Qty");
      assert(await p.eval<boolean>(`!!document.querySelector('[aria-label="Table tab"]')`), "contextual Table tab appears");
    });

    await t.step("spreadsheet: edit a cell, formulas recalculate", async () => {
      await p.eval(`jw.load("Total: [?]{calc=\\"S!B2\\"}\\n\\n{#S}\\n\`\`\` =sheet\\n| a | =A1*2 |\\n| 4 | =SUM(B1,A2) |\\n\`\`\`\\n")`);
      await wait(300);
      assertEquals(await p.eval<string>(`document.querySelector('.jw-sheet-grid td[data-r="1"][data-c="1"]').textContent`), "#VALUE!");
      await p.click('.jw-sheet-grid td[data-r="0"][data-c="0"]');
      await p.press("21");
      await p.key("Enter");
      await wait(400);
      assertEquals(await p.eval<string>(`document.querySelector('.jw-sheet-grid td[data-r="0"][data-c="1"]').textContent`), "42");
      assertEquals(await p.eval<string>(`document.querySelector('.jw-sheet-grid td[data-r="1"][data-c="1"]').textContent`), "46");
      assertEquals(await p.eval<string>(`document.querySelector('.jw-calc').textContent`), "46");
    });

    await t.step("save → single .html file that opens without Writy", async () => {
      const path = `${tmp}/report.html`;
      assert(await p.eval<boolean>(`jw.saveTo(${JSON.stringify(path)})`));
      const html = await Deno.readTextFile(path);
      assertStringIncludes(html, '<script type="text/x-djot" id="jw-src">');
      assertStringIncludes(html, '[46]{calc="S!B2"}'); // cached value refreshed on save
      assertStringIncludes(html, '<td class="num">46</td>');
      const viewer = await launch(`file://${path}`);
      try {
        await wait(500);
        assertEquals(await viewer.eval<string>(`document.querySelector(".jw-calc").textContent`), "46");
        assertEquals(await viewer.eval<number>(`document.querySelectorAll(".jw-stale").length`), 0);
      } finally {
        await viewer.close();
      }
    });

    await t.step("reopen the saved file", async () => {
      await p.eval(`jw.load("")`);
      await p.eval(`jw.open(${JSON.stringify(`${tmp}/report.html`)})`);
      await wait(400);
      assertStringIncludes(await src(p), "=SUM(B1,A2)");
    });

    for (const f of ["t.docx", "t.odt", "t.html"]) {
      await t.step(`import ${f}`, async () => {
        await p.eval(`jw.open(${JSON.stringify(fixture(f))})`);
        await wait(400);
        const s = await src(p);
        assertStringIncludes(s, "# Quarterly Report");
        assertStringIncludes(s, "colspan=2");
        assert(await p.eval<boolean>(`!!document.querySelector(".jw-media img")?.src`), "image shown");
      });
    }

    await t.step("source view edits flow into the document", async () => {
      await p.eval(`jw.load("Start")`);
      await p.click('[aria-label="Toggle source view"]');
      await wait(400);
      await p.click(".cm-content");
      await p.key("End", CTRL);
      await p.type("\n\n## From source");
      await wait(900);
      assert(await p.eval<boolean>(`[...document.querySelectorAll(".ProseMirror h2")].some((h) => h.textContent === "From source")`));
      await p.click('[aria-label="Toggle source view"]');
    });

    await t.step("track changes marks inserted text", async () => {
      await p.eval(`jw.load("Hello")`);
      await p.click('[aria-label="Review tab"]');
      await p.click('[aria-label^="Track changes"]');
      await p.click(".ProseMirror");
      await p.key("End", CTRL);
      await p.type(" world");
      await wait(100);
      assertStringIncludes(await src(p), "Hello {+world+}{");
      await p.click('[aria-label^="Tracking on"]');
    });

    await t.step("find & replace (Ctrl+F / Ctrl+H)", async () => {
      await p.eval(`jw.load("cat Cat dog cat")`);
      await p.click(".ProseMirror");
      await p.key("f", CTRL);
      await wait(150);
      await p.type("cat");
      await wait(150);
      assertEquals(await p.eval<string>(`document.querySelector(".jw-find-count").textContent`), "1 of 3");
      assertEquals(await p.eval<number>(`document.querySelectorAll(".ProseMirror .jw-find").length`), 3);
      await p.key("h", CTRL);
      await wait(150);
      await p.click('[aria-label="Replace with"]');
      await p.type("fox");
      await p.click('[aria-label="Replace all"]');
      await wait(150);
      assertStringIncludes(await src(p), "fox fox dog fox");
      await p.key("Escape");
      await wait(100);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-findbar, .ProseMirror .jw-find").length`), 0);
    });

    await t.step("unsaved changes: Save / Don't Save / Cancel dialog", async () => {
      await p.eval(`jw.load("Keep me")`);
      await p.click(".ProseMirror");
      await p.type("!");
      await p.key("n", CTRL);
      await wait(150);
      assertStringIncludes(await p.eval<string>(`document.querySelector('[role="alertdialog"]').textContent`), "Don't Save");
      await p.click('[role="alertdialog"] button:last-child'); // Cancel
      await wait(100);
      assertStringIncludes(await src(p), "Keep me");
      await p.key("n", CTRL);
      await wait(150);
      await p.eval(`[...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === "Don't Save").click()`);
      await wait(150);
      assert(!(await src(p)).includes("Keep me"), "new blank document");
    });

    await t.step("autosave writes a recovery draft; saving removes it", async () => {
      const dir = `${Deno.env.get("XDG_DATA_HOME") ?? `${Deno.env.get("HOME")}/.local/share`}/writy/drafts`;
      const drafts = async () => {
        const out: string[] = [];
        try {
          for await (const e of Deno.readDir(dir)) if (e.name.endsWith(".json")) out.push(JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`)).name);
        } catch { /* no drafts dir yet */ }
        return out;
      };
      await p.eval(`jw.load("Draft me")`);
      await p.click(".ProseMirror");
      await p.type("!");
      await wait(3600);
      assert((await drafts()).includes("Test.html"), "draft written");
      assert(await p.eval<boolean>(`jw.saveTo(${JSON.stringify(`${tmp}/draft.html`)})`));
      await wait(300);
      assert(!(await drafts()).includes("Test.html") && !(await drafts()).includes("draft.html"), "draft removed after save");
    });

    await t.step("shape: contextual Shape tab edits the selected shape", async () => {
      await p.eval(`jw.load("{kind=rect w=30mm h=12mm}\\n::: shape\\nBox\\n:::\\n\\nText under the shape.")`);
      await wait(200);
      await p.click(".jw-shape-box");
      await wait(150);
      await p.click('[aria-label="Shape tab"]');
      await p.click('[aria-label="Oval"]');
      await wait(100);
      assertStringIncludes(await src(p), "kind=ellipse");
      await p.click('[aria-label="Delete shape"]');
      await wait(100);
      assert(!(await src(p)).includes("::: shape"), "shape deleted");
    });

    await t.step("picture: contextual Picture tab sets wrap and width", async () => {
      await p.eval(`jw.open(${JSON.stringify(fixture("t.docx"))})`);
      await wait(400);
      await p.click(".jw-media img");
      await wait(150);
      await p.click('[aria-label="Picture tab"]');
      await p.click('[aria-label="Float right"]');
      await p.click('[aria-label="Width 50%"]');
      await wait(100);
      assertStringIncludes(await src(p), "float=right");
      assertStringIncludes(await src(p), 'width="50%"');
    });

    await t.step("reviewing pane lists comments and changes; resolve/accept", async () => {
      await p.eval(`jw.load("A [phrase]{comment=\\"Check\\" by=Ann} and {+new+}{by=Bob} text.")`);
      await p.click('[aria-label="Review tab"]');
      await p.click('[aria-label="Reviewing pane"]');
      await wait(150);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-note").length`), 2);
      await p.click('[aria-label="Resolve comment"]');
      await p.click('[aria-label="Accept change"]');
      await wait(150);
      assertStringIncludes(await src(p), "A phrase and new text.");
      await p.click('[aria-label="Close reviewing pane"]');
    });

    await t.step("copy & paste inside Writy keeps colour, alignment and comments", async () => {
      await p.eval(`jw.load("{align=center}\\nSome [red]{color=red} and [noted]{comment=\\"Hi\\"} words.")`);
      await p.click(".ProseMirror");
      await p.key("a", CTRL);
      await p.eval(`(() => {
        window.dt = new DataTransfer();
        jw.view().dom.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true }));
      })()`);
      await p.key("End", CTRL);
      await wait(100);
      await p.eval(`jw.view().dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))`);
      await wait(150);
      const s = await src(p);
      assertEquals(s.match(/\[red\]\{color=red\}/g)?.length, 2, s);
      assertEquals(s.match(/comment=Hi/g)?.length, 2, s);
      assertEquals(s.match(/\{align=center\}/g)?.length, 2, s);
    });

    await t.step("paste from another app: colours kept, Google Docs bold wrapper ignored", async () => {
      await p.eval(`jw.load("Start")`);
      await p.click(".ProseMirror");
      await p.key("End", CTRL);
      await wait(100);
      await p.eval(`(() => {
        const dt = new DataTransfer();
        dt.setData("text/html", '<b style="font-weight:normal"><p>x</p><p style="text-align:right">Hi <span style="color:#ff0000;font-family:Arial;font-size:11pt">red</span> <span style="font-weight:700">bold</span></p><img src="data:image/png;base64,iVBORw0KGgo=" width="40"></b>');
        jw.view().dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      })()`);
      await wait(150);
      const s = await src(p);
      assertStringIncludes(s, '[red]{color="#ff0000"}');
      assertStringIncludes(s, "*bold*");
      assertStringIncludes(s, "{align=right}");
      assert(!s.includes("Arial"), "fonts from other apps are dropped");
      assertStringIncludes(s, "](#att:pasted.png)");
    });

    await t.step("import PDF (via poppler)", async () => {
      const cmd = new Deno.Command("soffice", {
        args: ["--headless", "--convert-to", "pdf", "--outdir", tmp, fixture("t.docx")],
        stdout: "null",
        stderr: "null",
      });
      await cmd.output();
      await p.eval(`jw.open(${JSON.stringify(`${tmp}/t.pdf`)})`);
      await wait(1500);
      const s = await src(p);
      assertStringIncludes(s, "# Quarterly Report");
      assertStringIncludes(s, "H~2~O");
      assert(await p.eval<boolean>(`!!document.querySelector(".jw-media img")?.src`), "PDF image shown");
    });

    await t.step("export DOCX/ODT (via LibreOffice) and re-import", async () => {
      await p.eval(`jw.load("# Exported\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |")`);
      await p.eval(`jw.exportTo(${JSON.stringify(`${tmp}/out.docx`)}, "docx")`);
      await p.eval(`jw.exportTo(${JSON.stringify(`${tmp}/out.odt`)}, "odt")`);
      for (const f of ["out.docx", "out.odt"]) {
        await p.eval(`jw.open(${JSON.stringify(`${tmp}/${f}`)})`);
        await wait(400);
        const s = await src(p);
        assertStringIncludes(s, "Exported", f);
        assertStringIncludes(s, "- - 1\n  - 2", f);
      }
    });

    await t.step("slideshow opens and closes", async () => {
      await p.eval(`jw.load("# One\\n\\nA\\n\\n# Two\\n\\nB")`);
      await p.key("F5");
      await wait(300);
      assertStringIncludes(await p.eval<string>(`document.querySelector(".jw-show-bar")?.textContent ?? ""`), "1 / 2");
      await p.key("Escape");
      await wait(200);
      assertEquals(await p.eval<number>(`document.querySelectorAll(".jw-show").length`), 0);
    });
  } finally {
    await p.close();
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});
