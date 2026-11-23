(() => {
  const M = document.querySelector("main.jw-page[data-pages]");
  if (!M) return;
  const c = JSON.parse(M.dataset.pages), X = 96 / 25.4, G = 24, H = c.h * X, T = c.m[0] * X, B = c.m[2] * X, S = H + G, R = H - T - B;
  document.body.classList.add("jw-paged");
  const bk = document.createElement("div"), sh = document.createElement("div");
  bk.className = "jw-book";
  bk.style.width = c.w + "mm";
  sh.className = "jw-pg-sheets";
  sh.setAttribute("aria-hidden", "true");
  M.before(bk);
  bk.append(sh, M);
  const BLK = ":scope>:is(p,ul,ol,div,blockquote,pre,table,figure,dl,h1,h2,h3,h4,h5,h6,section,nav,hr)";
  const open = (e) =>
    (/^(UL|OL|LI|BLOCKQUOTE|DL|DD)$/.test(e.tagName) || e.matches("div:not(.jw-chart,.jw-anchor,.page-break),section.footnotes")) && !!e.querySelector(BLK);
  // a long table breaks between body rows: never before the first one or across a rowspan; the header rows repeat
  const live = (s) => s ? [...s.rows].filter((r) => !r.matches(".jw-pg,.jw-pg-head")) : [];
  const rows = (t, o) => {
    const tu = o[o.length - 1], hd = live(t.tHead), bd = live(t.tBodies[0]), n = Math.max(1, ...[...hd, ...bd].map((r) => [...r.cells].reduce((s, c) => s + c.colSpan, 0)));
    let cv = 0;
    bd.forEach((e, i) => {
      if (i > 0 && i > cv) o.push({ e, f: false, r: { n, hd } });
      for (const c of e.cells) cv = Math.max(cv, i + c.rowSpan - 1);
    });
    tu.ld = bd[0] || hd[hd.length - 1];
  };
  const units = () => {
    const o = [];
    let f = false;
    const w = (p) => {
      for (const e of p.children) {
        if (e.matches("script,style,.jw-shape")) continue;
        if (open(e)) {
          w(e);
          continue;
        }
        o.push({ e, f });
        f = e.matches(".page-break,.jw-slide");
        if (e.tagName == "TABLE") rows(e, o);
      }
    };
    w(M);
    return o;
  };
  const place = (y, h, f) => {
    const k = Math.max(0, Math.floor(y / S)), i = y - k * S, hd = k * S + T, nx = (k + 1) * S + T;
    if (i < T - .5) return hd;
    const at = i <= T + 1;
    if (f) return at ? y : nx;
    return at || i + h <= H - B + .5 || h > R ? y : nx;
  };
  const gap = (e) => {
    const p = e.previousElementSibling;
    return p ? parseFloat(getComputedStyle(p).marginBottom) || 0 : 0;
  };
  const hf = (t, n, N) => {
    if (!t || !t.trim()) return null;
    const p = t.split("|").map((s) => s.trim().replace(/\{title\}/g, c.title).replace(/\{pages\}/g, N).replace(/\{page\}/g, n));
    return p.length == 1 ? ["", p[0], ""] : p.length == 2 ? [p[0], "", p[1]] : p.slice(0, 3);
  };
  const spec = new Map();
  const lay = () => {
    let end = 0;
    for (let pass = 0; pass < 4; pass++) {
      const r0 = M.getBoundingClientRect(), z = r0.height / (M.offsetHeight || 1) || 1;
      const L = units(), rs = L.map((u) => u.e.getBoundingClientRect()), tp = rs.map((r) => (r.top - r0.top) / z), hs = rs.map((r) => r.height / z);
      // what must fit: a table taller than a sheet only its start; a moved row brings copies of the header rows
      const ft = hs.map((h, i) => L[i].ld && h > R ? (L[i].ld.getBoundingClientRect().bottom - rs[i].top) / z : h);
      const hh = L.map((u) => u.r ? u.r.hd.reduce((s, r) => s + r.getBoundingClientRect().height / z, 0) : 0);
      let mv = 0, sf = 0, ch = false;
      const pu = [];
      end = 0;
      L.forEach((u, i) => {
        const was = spec.get(u.e), nat = tp[i] - mv - (was ? was.d : 0);
        mv += was ? was.d : 0;
        const y = nat + sf;
        const keep = /^H[1-6]$/.test(u.e.tagName) && i + 1 < L.length ? ft[i + 1] + 12 : 0;
        const t = place(y, ft[i] + keep <= R ? ft[i] + keep : ft[i], u.f), D = t > y + .5 ? t - y + hh[i] : 0;
        sf += D;
        end = Math.max(end, y + D + hs[i]);
        if (D <= .5) {
          if (was) {
            spec.delete(u.e);
            u.e.style.removeProperty("--jw-mt");
            was.g && was.g.forEach((x) => x.remove());
            ch = true;
          }
          return;
        }
        const cm = was ? was.m - was.d : u.r ? 0 : Math.max(parseFloat(getComputedStyle(u.e).marginTop) || 0, gap(u.e)),
          s = { m: Math.round((cm + D) * 10) / 10, d: was ? was.d : D, g: was && was.g };
        if (!was || Math.abs(s.m - was.m) > .5) ch = true;
        spec.set(u.e, s);
        if (u.r) {
          // a row takes no margin: a gap row, then the header copies, before it
          if (!s.g) {
            const tr = document.createElement("tr"), td = document.createElement("td");
            tr.className = "jw-pg";
            td.colSpan = u.r.n;
            tr.append(td);
            s.g = [tr, ...u.r.hd.map((r) => Object.assign(r.cloneNode(true), { className: "jw-pg-head" }))];
            u.e.before(...s.g);
          }
          s.g[0].firstChild.style.height = Math.max(0, s.m - hh[i]) + "px";
        } else u.e.style.setProperty("--jw-mt", s.m + "px");
        pu.push({ e: u.e, nat, s });
      });
      if (!ch) break;
      const r1 = M.getBoundingClientRect().top;
      let sum = 0;
      for (const p of pu) {
        p.s.d = Math.max(0, (p.e.getBoundingClientRect().top - r1) / z - p.nat - sum);
        sum += p.s.d;
      }
    }
    const N = Math.max(1, Math.floor(Math.max(0, end + B - .5) / S) + 1);
    M.style.setProperty("--jw-book-h", N * S - G + "px");
    const line = (cls, p, mm) => {
      if (!p) return "";
      const d = document.createElement("div");
      d.className = "jw-pg-hf " + cls;
      d.style[cls == "head" ? "top" : "bottom"] = mm + "mm";
      d.style.padding = "0 " + c.m[1] + "mm 0 " + c.m[3] + "mm";
      for (const x of p) {
        const s = document.createElement("span");
        s.textContent = x;
        d.append(s);
      }
      return d;
    };
    sh.replaceChildren(...Array.from({ length: N }, (_, i) => {
      const d = document.createElement("div");
      d.className = "jw-pg-sheet";
      d.style.top = i * S + "px";
      d.style.height = H + "px";
      d.append(line("head", hf(c.head, i + 1, N), c.m[0] / 2) || "", line("foot", hf(c.foot, i + 1, N), c.m[2] / 2) || "");
      return d;
    }));
  };
  const fit = () => {
    bk.style.zoom = "";
    const w = bk.offsetWidth, a = document.documentElement.clientWidth - 16;
    bk.style.zoom = w > a ? String(a / w) : "";
  };
  lay();
  fit();
  addEventListener("load", lay);
  document.fonts && document.fonts.ready.then(lay);
  addEventListener("resize", fit);
})();
