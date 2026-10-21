// Accessibility probe, evaluated in the page: unnamed controls, icon buttons without a tooltip, WCAG AA text contrast.
(() => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const name = (e) =>
    (e.getAttribute("aria-label") || e.getAttribute("title") || (e.labels && e.labels[0] && e.labels[0].textContent) || e.textContent || "").trim();
  const out = { unnamed: [], noTip: [], contrast: [] };
  const app = document.querySelectorAll(
    ".jw-app button, .jw-app input, .jw-app select, .jw-backstage button, .jw-modal button, .jw-modal input, .jw-modal select, .jw-menu button, .jw-palette button",
  );
  for (const e of app) {
    if (!vis(e) || e.closest(".ProseMirror")) continue;
    if (!name(e)) out.unnamed.push(e.outerHTML.slice(0, 90));
    const iconOnly = !e.textContent.trim() && e.tagName === "BUTTON";
    if (iconOnly && !e.getAttribute("title") && !e.classList.contains("jw-swatch")) out.noTip.push(e.getAttribute("aria-label"));
  }
  const rgb = (c) => {
    const m = c.match(/[\d.]+/g);
    return m ? m.map(Number) : [0, 0, 0, 1];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (e) => {
    for (let x = e; x; x = x.parentElement) {
      const c = rgb(getComputedStyle(x).backgroundColor);
      if ((c[3] ?? 1) > 0.5 && getComputedStyle(x).backgroundColor !== "rgba(0, 0, 0, 0)") return c;
    }
    return [255, 255, 255];
  };
  const seen = new Set();
  for (const e of document.querySelectorAll(".jw-app *, .jw-backstage *, .jw-modal *, .jw-menu *")) {
    if (e.closest(".ProseMirror, .jw-sheet, .jw-tpl-thumb, .jw-swatch, svg") || !vis(e)) continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const s = getComputedStyle(e);
    if (e.closest("button:disabled, [aria-disabled=true]")) continue;
    const fg = rgb(s.color), bg = bgOf(e);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
    const need = large ? 3 : 4.5;
    const key = e.className + "|" + e.textContent.trim().slice(0, 20);
    if (ratio < need && !seen.has(key)) {
      seen.add(key);
      out.contrast.push(
        `${ratio.toFixed(2)} ${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} "${e.textContent.trim().slice(0, 24)}" ${s.color} on rgb(${
          bg.slice(0, 3)
        })`,
      );
    }
  }
  return JSON.stringify(out);
})();
