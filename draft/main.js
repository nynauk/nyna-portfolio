/* NYNA draft: "Backlit"
   The page is NYNA's board and the cursor is a light held behind it.
   Two copper layers are routed around the real layout (all content is a keep-out):
   the top layer sharp, an inner layer softer and set deeper. The routing shows
   faintly through the mask everywhere, and vividly wherever the light is, with
   small charges running along the traces. Leave the page alone and the light
   wanders across the board by itself. Holes (honeycomb, mounting holes, the work
   window, mouse bites) are CSS and show the light directly, with soft bore walls
   that shift as you scroll. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = document.documentElement;
  const board = $('#board');
  const tilesEl = $('#tiles');
  if (!board || !tilesEl) return;

  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = mqReduce.matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // iOS ignores background-attachment: fixed, so holes fall back to the plain bench there.
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (iOS) root.classList.add('no-fixed-bg');

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: still works this visit */ } }
  };

  const TAU = Math.PI * 2;
  const THEME_KEY = 'nyna-draft-theme';
  const IN_S = 0.991;          // inner copper sits deeper in the board: projected toward the screen centre
  const HOLE_S = 0.993;        // the far side of a drilled hole, likewise (kept shallow: a hint, not a trench)
  const WANDER_AFTER = 2600;   // ms without input before the light starts wandering on its own
  const NUDGE_AFTER = 6000;    // ms without input before the call to action starts pulsing
  const REST_AFTER = 60000;    // ms without input before everything settles and the animation loop stops
  const WARM_MS = 1500;
  const NS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------ palettes */

  // what the light does to each board: FR4 glow, copper, drills, and the charges
  const PALETTE = {
    light: {
      glow: [[0, '190,236,253', 0.5], [0.32, '120,214,250', 0.32], [0.64, '12,143,203', 0.1], [1, '12,143,203', 0]],
      copper: 'rgb(12, 58, 90)', inner: 'rgb(22, 88, 128)', innerAlpha: 0.5,
      drill: 'rgb(236, 250, 255)', fall: [0.8, 0.5],
      head: '255,255,255', halo: '0,150,230', tail: '0,128,212',
      meta: '#1A222C'
    },
    dark: {
      glow: [[0, '94,207,249', 0.22], [0.35, '30,150,215', 0.11], [0.7, '12,100,160', 0.035], [1, '12,100,160', 0]],
      copper: 'rgb(94, 207, 249)', inner: 'rgb(34, 132, 186)', innerAlpha: 0.66,
      drill: 'rgb(9, 12, 16)', fall: [0.78, 0.46],
      head: '255,255,255', halo: '94,207,249', tail: '170,236,255',
      meta: '#07090C'
    }
  };

  /* ------------------------------------------------------------------ state */

  let theme = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  let pal = PALETTE[theme];
  let net = null, ghost = null;
  let tiles = [];
  let dpr = Math.min(1.5, window.devicePixelRatio || 1);
  let cacheKey = '';
  const vis = { top: [], inner: [] };
  let raf = 0, lastT = 0, lastPaint = 0, warmFrom = 0, lastScrollY = -1, prevSY = scrollY;
  let chargeA = 0, chargeT = 0, surge = 0;
  let wander = 0, lastInput = performance.now(), isIdle = false;
  let railP = 0, railTarget = 0, railOn = false;
  // The things the light shows through, and only while they're on screen. Small plated holes
  // just glow by how near the light is; the outlined NYNA gets the light's position relative to
  // its letters; without WebGL the big holes fall back to a gradient pinned to the screen.
  const litEls = new Set(), litLast = new WeakMap();
  let litI = 0, litR = 300, litDirty = true;
  function paintLit() {
    const items = [];
    for (const el of litEls) items.push([el, el.getBoundingClientRect()]);   // every read first
    for (const [el, r] of items) {
      let v, props;
      if (el.classList.contains('brand-v')) {
        v = `${(light.x - r.left).toFixed(0)}|${(light.y - r.top).toFixed(0)}|${litI.toFixed(3)}|${litR.toFixed(0)}`;
        props = ['--lx', '--ly', '--li', '--lr'];
      } else if (el.matches('.perf, .window, .model-stage')) {
        v = `${light.x.toFixed(0)}|${light.y.toFixed(0)}|${litI.toFixed(3)}|${litR.toFixed(0)}`;
        props = ['--lx', '--ly', '--li', '--lr'];
      } else {
        const d = Math.hypot(r.left + r.width / 2 - light.x, r.top + r.height / 2 - light.y);
        v = (litI * Math.pow(Math.max(0, 1 - d / litR), 1.4)).toFixed(2);
        props = ['--hl'];
      }
      if (litLast.get(el) === v) continue;
      litLast.set(el, v);
      const parts = v.split('|');
      props.forEach((p, k) => el.style.setProperty(p, parts[k]));
    }
  }
  const litIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => {
    for (const e of es) { if (e.isIntersecting) litEls.add(e.target); else litEls.delete(e.target); }
    litDirty = true; kick();
  }, { rootMargin: '120px 0px' }) : null;
  let lastVars = '';
  function watchLight() {
    if (litIO) litIO.disconnect();
    litEls.clear();
    const sel = surfaceOn ? '.mhole, .brand-v, .thole, .tab, .tp-pad' : '.mhole, .perf, .brand-v, .window, .thole, .tab, .tp-pad, .model-stage';
    litDirty = true;
    $$(sel).forEach(el => { if (litIO) litIO.observe(el); else litEls.add(el); });
  }
  const perfs = [];
  let surfaceOn = false, surfaceSvg = null, holes = [];
  let bench = null, benchT = 0, benchKey = '', benchLast = 0;
  const win = $('#window');
  const sections = $$('main section[id]');
  const popLinks = $$('.pop-nav a');
  const railv = $('#railv'), railTrack = $('#rail-track'), railLabels = $('#rail-labels');
  const railBrand = railv && $('.rail-v-brand', railv);
  let railCurrent = null;

  /* ------------------------------------------------------------------ light */

  const baseR = () => Math.max(150, Math.min(290, Math.min(innerWidth, innerHeight) * 0.31));
  const light = {
    x: innerWidth * (fine ? 0.8 : 0.68),
    y: innerHeight * (fine ? 0.5 : 0.42),
    tx: 0, ty: 0, i: 0, r: 0, tr: baseR(), boost: 0,
    on: store.get('nyna-draft-backlight') !== 'off'
  };
  light.tx = light.x; light.ty = light.y; light.r = light.tr * 0.62;
  const cursor = { x: light.x, y: light.y };

  // where the light drifts when nobody is holding it: a slow, never-repeating loop over the screen
  const wanderAt = t => {
    const s = t / 1000;
    return [
      innerWidth * (0.5 + 0.3 * Math.sin(s * 0.21 + 0.6) + 0.14 * Math.sin(s * 0.47 + 2.3)),
      innerHeight * (0.5 + 0.26 * Math.sin(s * 0.16 + 1.9) + 0.12 * Math.sin(s * 0.39 + 0.2))
    ];
  };

  /* ------------------------------------------------------------------ routing */

  const P = 12;                                        // routing grid pitch, px
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // parallel copy of a polyline, mitred at each 45° bend so bus spacing holds through the turn
  function offsetPath(pts, d) {
    const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
    return pts.map((p, k) => {
      const a = k > 0 ? nrm(pts[k - 1], p) : null;
      const b = k < pts.length - 1 ? nrm(p, pts[k + 1]) : null;
      let n = a || b;
      if (a && b) {
        const mx = a[0] + b[0], my = a[1] + b[1], ml = Math.hypot(mx, my) || 1;
        const s = 1 / Math.sqrt(Math.max(0.2, (1 + a[0] * b[0] + a[1] * b[1]) / 2));
        n = [mx / ml * s, my / ml * s];
      }
      return [p[0] + n[0] * d, p[1] + n[1] * d];
    });
  }

  function extend(pts, atEnd, len) {
    if (!len) return pts;
    const p = pts.slice();
    const [a, b, i] = atEnd ? [p[p.length - 2], p[p.length - 1], p.length - 1] : [p[1], p[0], 0];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    p[i] = [b[0] + (b[0] - a[0]) / l * len, b[1] + (b[1] - a[1]) / l * len];
    return p;
  }

  // arc-length table, so a charge can be placed anywhere along a trace
  function measure(t) {
    const cum = [0];
    for (let k = 1; k < t.p.length; k++) cum.push(cum[k - 1] + Math.hypot(t.p[k][0] - t.p[k - 1][0], t.p[k][1] - t.p[k - 1][1]));
    t.cum = cum; t.L = cum[cum.length - 1];
    return t;
  }
  function charge(rnd, L, sp, ph, per, rev) {
    per = per || L + 40 + rnd() * L * 0.7;
    return { sp, per, ph: ph === undefined ? rnd() * per : ph, rev: rev === undefined ? rnd() < 0.5 : rev };
  }

  // one copper layer on its own occupancy grid; keep-outs are shared, crossings between layers are fine
  function route(occ, g, opts) {
    const { W, H, C, R, rnd, br, EDGE } = g;
    const freeCell = (i, j) => i >= 0 && j >= 0 && i < C && j < R && !occ[j * C + i];
    const freePx = (x, y) => freeCell(Math.floor(x / P), Math.floor(y / P));
    const markPx = (x, y) => { const i = Math.floor(x / P), j = Math.floor(y / P); if (i >= 0 && j >= 0 && i < C && j < R) occ[j * C + i] = 1; };
    const along = (pts, fn) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 5));
        for (let s = 0; s <= n; s++) if (fn(x1 + (x2 - x1) * s / n, y1 + (y2 - y1) * s / n) === false) return false;
      }
      return true;
    };
    const traces = [], vias = [];
    const pc = opts.chargeP;

    // 1. fan-outs from the chip pads: a stub, a 45° dog-leg away from centre, then a via
    if (opts.fanout) {
      $$('[data-fanout]').forEach(el => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el, '::after');
        const left = r.left - br.left, top = r.top - br.top, right = left + r.width, bottom = top + r.height;
        const pl = parseFloat(cs.left) || 40, pr = parseFloat(cs.right) || 30, mid = (left + right) / 2;
        for (let x = left + pl + 4.5; x < right - pr; x += 24) {
          for (const side of [-1, 1]) {
            if (rnd() < 0.28) continue;
            const y0 = side < 0 ? top - 12 : bottom + 12, out = x < mid ? -1 : 1;
            const l1 = 10 + rnd() * 12, l2 = 8 + rnd() * 30, l3 = rnd() < 0.55 ? 0 : 8 + rnd() * 22;
            const p1 = [x, y0 + side * l1], p2 = [p1[0] + out * l2, p1[1] + side * l2];
            const path = l3 ? [[x, y0], p1, p2, [p2[0], p2[1] + side * l3]] : [[x, y0], p1, p2];
            let t = null;
            if (along(path.slice(1), freePx)) {
              along(path, markPx); t = { p: path, w: 1.2 }; vias.push(path[path.length - 1]);
            } else if (freePx(p1[0], p1[1])) {
              const stub = [[x, y0], p1];
              along(stub, markPx); t = { p: stub, w: 1.2 }; vias.push(p1);
            }
            if (!t) continue;
            measure(t);
            // current leaves the pin and heads out to the via
            if (t.L > 20 && rnd() < 0.45) t.ch = [charge(rnd, t.L, 24 + rnd() * 30, undefined, t.L + 40 + rnd() * 140, false)];
            traces.push(t);
          }
        }
      });
    }

    // 2. buses: parallel runs that bend together, ends staggered so the vias clear each other
    const busTries = Math.round(W * H / opts.busDiv);
    for (let n = 0; n < busTries; n++) {
      const k = 3 + Math.floor(rnd() * 5), sp = 9;
      let x = (EDGE + 2 + rnd() * (C - 2 * EDGE - 4)) * P, y = (EDGE + 2 + rnd() * (R - 2 * EDGE - 4)) * P;
      let dir = [0, 2, 4, 6][Math.floor(rnd() * 4)];
      const lead = [[x, y]], legs = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < legs; s++) {
        const len = (s % 2 === 0 ? 4 + rnd() * 16 : 2 + rnd() * 4) * P;
        const [dx, dy] = DIRS[dir], l = Math.hypot(dx, dy);
        x += dx / l * len; y += dy / l * len; lead.push([x, y]);
        dir = (dir + (rnd() < 0.5 ? 1 : 7)) % 8;
      }
      const lines = [];
      for (let m = 0; m < k; m++) {
        const line = offsetPath(lead, (m - (k - 1) / 2) * sp);
        lines.push(extend(extend(line, true, (m % 3) * 11), false, ((m + 1) % 3) * 11));
      }
      if (!lines.every(line => along(line, freePx))) continue;
      // a bus carries its data together: every line pulses in step
      const group = rnd() < pc * 1.6 ? { sp: 60 + rnd() * 50, rev: rnd() < 0.5, ph: rnd() * 1000 } : null;
      const ts = lines.map(line => measure({ p: line, w: 1.2 }));
      const Lmax = Math.max(...ts.map(t => t.L));
      const per = Lmax + 90 + rnd() * Lmax;
      for (const t of ts) {
        along(t.p, markPx);
        if (group) t.ch = [charge(rnd, t.L, group.sp, group.ph % per, per, group.rev)];
        traces.push(t);
        vias.push(t.p[0], t.p[t.p.length - 1]);
      }
    }

    // 3. single traces: grid walks that like long straight runs and turn at 45°
    const tries = Math.round(W * H / opts.trDiv);
    for (let n = 0; n < tries; n++) {
      let i = Math.floor(rnd() * C), j = Math.floor(rnd() * R);
      if (!freeCell(i, j)) continue;
      let dir = Math.floor(rnd() * 8);
      if (dir % 2 && rnd() < 0.7) dir = (dir + 1) % 8;
      const maxLen = 8 + Math.floor(rnd() * 52), cells = [[i, j]];
      occ[j * C + i] = 1;
      let len = 0, straight = 0;
      while (len < maxLen) {
        if (straight >= 2 && rnd() < (dir % 2 ? 0.5 : 0.08)) { cells.push([i, j]); dir = (dir + (rnd() < 0.5 ? 1 : 7)) % 8; straight = 0; }
        const [di, dj] = DIRS[dir], ni = i + di, nj = j + dj;
        // stop at anything in the way, and never squeeze diagonally between two occupied cells
        if (!freeCell(ni, nj) || (di && dj && !freeCell(i + di, j) && !freeCell(i, j + dj))) break;
        i = ni; j = nj; occ[j * C + i] = 1; len++; straight++;
      }
      if (len < 3) continue;
      cells.push([i, j]);
      const p = [];
      for (const [a, b] of cells) {
        const q = [a * P + P / 2, b * P + P / 2], last = p[p.length - 1];
        if (!last || last[0] !== q[0] || last[1] !== q[1]) p.push(q);
      }
      if (p.length < 2) continue;
      const t = measure({ p, w: rnd() < 0.12 ? 2.4 : 1.2 });
      if (t.L >= 48 && rnd() < pc) {
        const c = charge(rnd, t.L, 40 + rnd() * 90);
        t.ch = [c];
        if (t.L > 280 && rnd() < 0.5) t.ch.push({ sp: c.sp, per: c.per, ph: c.ph + c.per / 2, rev: c.rev });
      }
      traces.push(t);
      if (opts.vias) {
        vias.push(p[p.length - 1]);
        if (rnd() < 0.45) vias.push(p[0]);
      }
    }

    // spatial index, so each frame only touches what sits under the light
    const B = 160, bc = Math.ceil(W / B), bn = Math.ceil(H / B);
    const tb = Array.from({ length: bc * bn }, () => []);
    const vb = Array.from({ length: bc * bn }, () => []);
    traces.forEach((t, idx) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of t.p) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      for (let bj = Math.max(0, Math.floor(y0 / B)); bj <= Math.min(bn - 1, Math.floor(y1 / B)); bj++)
        for (let bi = Math.max(0, Math.floor(x0 / B)); bi <= Math.min(bc - 1, Math.floor(x1 / B)); bi++) tb[bj * bc + bi].push(idx);
    });
    return { traces, vias, tb, vb, bc, bn, B, seen: new Uint32Array(traces.length), stamp: 0 };
  }

  function generate() {
    const br = board.getBoundingClientRect();
    const W = Math.round(br.width), H = Math.round(br.height);
    const C = Math.ceil(W / P), R = Math.ceil(H / P);
    const base = new Uint8Array(C * R);
    const rnd = mulberry32(0x4E594E41 ^ Math.imul(W, 73856093) ^ Math.imul(H, 19349663));
    const EDGE = 3;                                    // cells reserved for the ground ring

    for (let j = 0; j < R; j++) {
      if (j < EDGE || j >= R - EDGE) { base.fill(1, j * C, j * C + C); continue; }
      base.fill(1, j * C, j * C + EDGE); base.fill(1, j * C + C - EDGE, j * C + C);
    }
    const block = (x, y, w, h, pad) => {
      const i0 = Math.max(0, Math.floor((x - pad) / P)), i1 = Math.min(C - 1, Math.floor((x + w + pad) / P));
      const j0 = Math.max(0, Math.floor((y - pad) / P)), j1 = Math.min(R - 1, Math.floor((y + h + pad) / P));
      for (let j = j0; j <= j1; j++) base.fill(1, j * C + i0, j * C + i1 + 1);
    };
    // content is a keep-out: copper never runs behind anything you need to read.
    // Text regions only block their actual lines, so routing can hug a short line
    // of a headline the way an autorouter hugs a component.
    const blockRect = (r, pad) => block(r.left - br.left, r.top - br.top, r.width, r.height, pad);
    const range = document.createRange();
    const textRects = el => {
      const out = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: n => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
      });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width && r.height) out.push(r);
      }
      // solid things inside a text region still keep their whole box clear
      el.querySelectorAll('a.btn, button, input, textarea, img, svg, table, .tp-pad, .perf').forEach(x => {
        const r = x.getBoundingClientRect();
        if (r.width && r.height) out.push(r);
      });
      // the test points share one trace: keep the whole run clear, not just each pad
      const pads = el.querySelectorAll('.tp-pad');
      if (pads.length > 1) {
        const rs = Array.from(pads, x => x.getBoundingClientRect());
        const x0 = Math.min(...rs.map(r => r.left)), y0 = Math.min(...rs.map(r => r.top));
        const x1 = Math.max(...rs.map(r => r.right)), y1 = Math.max(...rs.map(r => r.bottom));
        out.push(new DOMRect(x0, y0, x1 - x0, y1 - y0));
      }
      return out;
    };
    $$('[data-keepout], .fab, .pwr').forEach(el => {
      const mode = el.dataset.keepout;
      if (mode === 'text') { textRects(el).forEach(r => blockRect(r, 16)); return; }
      const r = el.getBoundingClientRect();
      if (r.width && r.height) blockRect(r, mode === '0' ? 0 : 14);
    });
    // the vertical section marker owns a clear channel down the left margin
    if (railv && getComputedStyle(railv).display !== 'none') {
      const rr = railv.getBoundingClientRect();
      block(rr.left - br.left, 0, rr.width, H, 12);
    }

    const g = { W, H, C, R, rnd, br, EDGE };
    const top = route(base.slice(), g, { fanout: true, vias: true, busDiv: 42000, trDiv: 4200, chargeP: 0.6 });
    const inner = route(base.slice(), g, { fanout: false, vias: false, busDiv: 56000, trDiv: 6200, chargeP: 0.36 });

    // stitching vias along the ground ring, then bucket every via on the top layer
    for (let x = 40; x < W - 40; x += 56) top.vias.push([x, 9], [x, H - 9]);
    for (let y = 40; y < H - 40; y += 56) top.vias.push([9, y], [W - 9, y]);
    top.vias.forEach((v, idx) => {
      const bi = Math.floor(v[0] / top.B), bj = Math.floor(v[1] / top.B);
      if (bi >= 0 && bj >= 0 && bi < top.bc && bj < top.bn) top.vb[bj * top.bc + bi].push(idx);
    });

    const rr = parseFloat(getComputedStyle(board).borderTopLeftRadius) || 20;
    net = { W, H, top, inner, ring: { x: 9, y: 9, w: W - 18, h: H - 18, r: Math.max(4, rr - 9) } };
    cacheKey = '';
    buildGhost();
  }

  // the top layer as it reads through the mask without any light: one faint vector drawing,
  // split into horizontal bands so painting can skip whatever is off screen
  function buildGhost() {
    const T = net.top, BAND = 800, f = n => Math.round(n * 2) / 2;
    const bands = [];
    const put = (y, kind, d) => {
      const k = Math.max(0, Math.floor(y / BAND));
      (bands[k] || (bands[k] = { thin: '', wide: '', via: '' }))[kind] += d;
    };
    for (const t of T.traces) {
      let d = `M${f(t.p[0][0])} ${f(t.p[0][1])}`;
      for (let i = 1; i < t.p.length; i++) d += `L${f(t.p[i][0])} ${f(t.p[i][1])}`;
      put(t.p[0][1], t.w > 2 ? 'wide' : 'thin', d);
    }
    for (const [x, y] of T.vias) put(y, 'via', `M${f(x + 2.6)} ${f(y)}a2.6 2.6 0 1 0 -5.2 0a2.6 2.6 0 1 0 5.2 0`);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ghost');
    svg.setAttribute('width', net.W); svg.setAttribute('height', net.H);
    svg.setAttribute('viewBox', `0 0 ${net.W} ${net.H}`);
    const g = net.ring, ring = document.createElementNS(NS, 'rect');
    ring.setAttribute('class', 'g-ring');
    ring.setAttribute('x', g.x); ring.setAttribute('y', g.y); ring.setAttribute('width', g.w); ring.setAttribute('height', g.h);
    ring.setAttribute('rx', g.r);
    svg.appendChild(ring);
    for (const b of bands) {
      if (!b) continue;
      for (const kind of ['thin', 'wide', 'via']) {
        if (!b[kind]) continue;
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('class', 'g-' + kind);
        p.setAttribute('d', b[kind]);
        svg.appendChild(p);
      }
    }
    ghost = svg;
  }

  /* ------------------------------------------------------------------ tiles */

  // canvases sit in the document and scroll natively with the content (no swimming);
  // only the ones under the light are ever painted or even allocated
  const TH = 720;

  function buildTiles() {
    tilesEl.textContent = '';
    if (surfaceSvg) tilesEl.appendChild(surfaceSvg);
    if (ghost) tilesEl.appendChild(ghost);
    tiles = [];
    for (let y = 0; y < net.H; y += TH) {
      const h = Math.min(TH, net.H - y), el = document.createElement('canvas');
      el.style.top = y + 'px'; el.style.width = net.W + 'px'; el.style.height = h + 'px';
      el.width = 0; el.height = 0;
      tilesEl.appendChild(el);
      // the board's glow stops at the edge of a hole: through a hole you see the bench, not the board
      let clip = null;
      if (surfaceOn && window.Path2D) {
        let d = `M0 ${y}H${net.W}V${y + h}H0Z`, any = false;
        for (const hl of holes) if (hl.y1 > y && hl.y0 < y + h) { d += hl.d; any = true; }
        if (any) clip = new Path2D(d);
      }
      tiles.push({ el, y, h, ctx: null, box: null, clip });
    }
  }
  function wake(t) {
    if (t.ctx) return;
    t.el.width = Math.ceil(net.W * dpr); t.el.height = Math.ceil(t.h * dpr);
    t.ctx = t.el.getContext('2d');
    t.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function sleep(t) {
    if (!t.ctx) return;
    t.el.width = 0; t.el.height = 0; t.ctx = null; t.box = null;
  }

  // light-local layers: copper is cached while the light holds still, charges are drawn fresh each frame
  const off = document.createElement('canvas');
  const topC = document.createElement('canvas');
  const inC = document.createElement('canvas');
  let octx = off.getContext('2d'), tctx = topC.getContext('2d'), ictx = inC.getContext('2d');

  function strokeLayer(ctx, L, x0, y0, S, out, wThin) {
    const stamp = ++L.stamp;
    out.length = 0;
    const bi0 = Math.max(0, Math.floor(x0 / L.B)), bi1 = Math.min(L.bc - 1, Math.floor((x0 + S) / L.B));
    const bj0 = Math.max(0, Math.floor(y0 / L.B)), bj1 = Math.min(L.bn - 1, Math.floor((y0 + S) / L.B));
    for (let bj = bj0; bj <= bj1; bj++) for (let bi = bi0; bi <= bi1; bi++) {
      for (const idx of L.tb[bj * L.bc + bi]) {
        if (L.seen[idx] === stamp) continue;
        L.seen[idx] = stamp;
        out.push(idx);
      }
    }
    // one path per width: a few hundred traces become two stroke calls
    for (const wide of [false, true]) {
      ctx.lineWidth = wide ? 2.4 : wThin;
      ctx.beginPath();
      for (const idx of out) {
        const t = L.traces[idx];
        if ((t.w > 2) !== wide) continue;
        ctx.moveTo(t.p[0][0], t.p[0][1]);
        for (let k = 1; k < t.p.length; k++) ctx.lineTo(t.p[k][0], t.p[k][1]);
      }
      ctx.stroke();
    }
    return { bi0, bi1, bj0, bj1 };
  }

  function renderCopper(ox, oy, S, vx, vy) {
    // top layer, full resolution
    const px = Math.ceil(S * dpr);
    if (topC.width !== px) { topC.width = px; topC.height = px; tctx = topC.getContext('2d'); }
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, px, px);
    tctx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
    tctx.lineCap = 'round'; tctx.lineJoin = 'round'; tctx.strokeStyle = pal.copper;
    const T = net.top, span = strokeLayer(tctx, T, ox, oy, S, vis.top, 1.2);
    const g = net.ring;
    if (tctx.roundRect && (ox < g.x + 40 || oy < g.y + 40 || ox + S > g.x + g.w - 40 || oy + S > g.y + g.h - 40)) {
      tctx.lineWidth = 2.4; tctx.beginPath(); tctx.roundRect(g.x, g.y, g.w, g.h, g.r); tctx.stroke();
    }
    const vs = [];
    for (let bj = span.bj0; bj <= span.bj1; bj++) for (let bi = span.bi0; bi <= span.bi1; bi++) {
      for (const vi of T.vb[bj * T.bc + bi]) vs.push(T.vias[vi]);
    }
    tctx.fillStyle = pal.copper; tctx.beginPath();
    for (const [vx0, vy0] of vs) { tctx.moveTo(vx0 + 3.6, vy0); tctx.arc(vx0, vy0, 3.6, 0, TAU); }
    tctx.fill();
    tctx.fillStyle = pal.drill; tctx.beginPath();
    for (const [vx0, vy0] of vs) { tctx.moveTo(vx0 + 1.5, vy0); tctx.arc(vx0, vy0, 1.5, 0, TAU); }
    tctx.fill();

    // inner layer at half resolution (the softness is the point), projected deeper
    const ids = Math.max(0.5, dpr * 0.5), ipx = Math.ceil(S * ids);
    if (inC.width !== ipx) { inC.width = ipx; inC.height = ipx; ictx = inC.getContext('2d'); }
    ictx.setTransform(1, 0, 0, 1, 0, 0);
    ictx.clearRect(0, 0, ipx, ipx);
    const s = IN_S;
    ictx.setTransform(ids * s, 0, 0, ids * s, ids * (vx * (1 - s) - ox), ids * (vy * (1 - s) - oy));
    ictx.lineCap = 'round'; ictx.lineJoin = 'round'; ictx.strokeStyle = pal.inner;
    strokeLayer(ictx, net.inner, vx + (ox - vx) / s, vy + (oy - vy) / s, S / s, vis.inner, 1.7);
  }

  // where a charge is: position s along a trace, and the path back along its tail
  function pointAt(t, s) {
    let k = 1;
    while (k < t.cum.length - 1 && t.cum[k] < s) k++;
    const a = t.p[k - 1], b = t.p[k], seg = (t.cum[k] - t.cum[k - 1]) || 1, f = (s - t.cum[k - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  function subPath(t, a, b) {
    const pts = [pointAt(t, a)];
    if (a < b) { for (let k = 1; k < t.p.length - 1; k++) if (t.cum[k] > a && t.cum[k] < b) pts.push(t.p[k]); }
    else { for (let k = t.p.length - 2; k >= 1; k--) if (t.cum[k] < a && t.cum[k] > b) pts.push(t.p[k]); }
    pts.push(pointAt(t, b));
    return pts;
  }
  function runCharges(L, list, time, A, sharp) {
    for (const idx of list) {
      const t = L.traces[idx];
      if (!t.ch) continue;
      for (const c of t.ch) {
        let s = (c.ph + c.sp * time) % c.per;
        if (s > t.L) continue;                          // resting between pulses
        const a = A * Math.min(1, s / 16, (t.L - s) / 16);
        if (a < 0.03) continue;
        if (c.rev) s = t.L - s;
        const tail = Math.min(30, t.L * 0.45);
        const s0 = c.rev ? Math.min(t.L, s + tail) : Math.max(0, s - tail);
        const pts = subPath(t, s0, s), q = pts[0], h = pts[pts.length - 1];
        if (Math.abs(h[0] - q[0]) + Math.abs(h[1] - q[1]) > 0.5) {
          const gr = octx.createLinearGradient(q[0], q[1], h[0], h[1]);
          gr.addColorStop(0, `rgba(${pal.tail},0)`);
          gr.addColorStop(1, `rgba(${pal.tail},${(0.95 * a).toFixed(3)})`);
          octx.strokeStyle = gr;
          octx.lineWidth = t.w > 2 ? 2.6 : 1.6;
          octx.beginPath(); octx.moveTo(q[0], q[1]);
          for (let k = 1; k < pts.length; k++) octx.lineTo(pts[k][0], pts[k][1]);
          octx.stroke();
        }
        if (sharp) {
          octx.fillStyle = `rgba(${pal.halo},${(0.45 * a).toFixed(3)})`;
          octx.beginPath(); octx.arc(h[0], h[1], 3.8, 0, TAU); octx.fill();
        }
        octx.fillStyle = `rgba(${pal.head},${a.toFixed(3)})`;
        octx.beginPath(); octx.arc(h[0], h[1], sharp ? 1.5 : 1.8, 0, TAU); octx.fill();
      }
    }
  }

  function draw() {
    if (!net) return;
    const br = board.getBoundingClientRect();
    const lx = light.x - br.left, ly = light.y - br.top;
    const I = light.i, R = light.r * (1 + light.boost), G = R * 1.14, S = G * 2;
    const ox = lx - G, oy = ly - G;
    const vx = innerWidth / 2 - br.left, vy = innerHeight / 2 - br.top;   // vanishing point, board space
    const lit = I > 0.004;

    if (lit) {
      const key = `${ox.toFixed(1)}|${oy.toFixed(1)}|${S.toFixed(1)}|${dpr}|${theme}`;
      if (key !== cacheKey) { renderCopper(ox, oy, S, vx, vy); cacheKey = key; }

      const px = Math.ceil(S * dpr);
      if (off.width !== px) { off.width = px; off.height = px; octx = off.getContext('2d'); }
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      octx.clearRect(0, 0, px, px);
      const ids = Math.max(0.5, dpr * 0.5);
      octx.globalAlpha = pal.innerAlpha;
      octx.drawImage(inC, 0, 0, inC.width * dpr / ids, inC.height * dpr / ids);
      octx.globalAlpha = 1;
      octx.drawImage(topC, 0, 0);

      if (chargeA > 0.01) {
        octx.lineCap = 'round'; octx.lineJoin = 'round';
        octx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
        runCharges(net.top, vis.top, chargeT, chargeA, true);
        const s = IN_S;
        octx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (vx * (1 - s) - ox), dpr * (vy * (1 - s) - oy));
        runCharges(net.inner, vis.inner, chargeT, chargeA * 0.5, false);
      }

      // everything fades out with distance from the light
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.globalCompositeOperation = 'destination-in';
      const fall = octx.createRadialGradient(G, G, 0, G, G, R);
      fall.addColorStop(0, `rgba(0,0,0,${pal.fall[0] * I})`);
      fall.addColorStop(0.5, `rgba(0,0,0,${pal.fall[1] * I})`);
      fall.addColorStop(1, 'rgba(0,0,0,0)');
      octx.fillStyle = fall; octx.fillRect(0, 0, S, S);
      octx.globalCompositeOperation = 'source-over';
    }

    for (const t of tiles) {
      const hit = lit && oy + S > t.y && oy < t.y + t.h;
      if (!hit) {
        if (t.ctx && t.box) { t.ctx.clearRect(t.box[0], t.box[1], t.box[2], t.box[3]); t.box = null; }
        if (t.ctx && Math.abs(t.y + t.h / 2 - ly) > 2000) sleep(t);
        continue;
      }
      wake(t);
      const c = t.ctx, y = oy - t.y;
      if (t.box) c.clearRect(t.box[0], t.box[1], t.box[2], t.box[3]);
      if (t.clip) { c.save(); c.translate(0, -t.y); c.clip(t.clip, 'evenodd'); c.translate(0, t.y); }
      // the board itself glowing where the light is
      const glow = c.createRadialGradient(lx, ly - t.y, 0, lx, ly - t.y, G);
      for (const [at, rgb, a] of pal.glow) glow.addColorStop(at, `rgba(${rgb},${(a * I).toFixed(3)})`);
      c.fillStyle = glow; c.fillRect(ox, y, S, S);
      c.drawImage(off, 0, 0, off.width, off.height, ox, y, S, S);
      if (t.clip) c.restore();
      t.box = [ox - 2, y - 2, S + 4, S + 4];
    }

    // the bench under the board, with the same light shining up through it
    if (bench) {
      // the bench stays still while the board scrolls over it, so scrolling alone never redraws it
      const key = `${light.x.toFixed(0)}|${light.y.toFixed(0)}|${(R * 0.95).toFixed(0)}|${I.toFixed(3)}|${theme}`;
      const t = performance.now();
      if (key !== benchKey || t - benchLast > 80) {
        bench.draw(benchT, light.x, light.y, R * 0.95, I);
        benchKey = key; benchLast = t;
      }
    }

    // holes read the light from CSS: updated when the light or the page moved
    const vars = `${light.x.toFixed(1)}|${light.y.toFixed(1)}|${I.toFixed(3)}|${(R * 0.95).toFixed(0)}|${scrollY}`;
    if (vars !== lastVars || litDirty) {
      lastVars = vars; litDirty = false;
      litI = I; litR = R * 0.95;
      paintLit();
    }
  }

  /* ------------------------------------------------------------------ depth */

  // the far side of each hole, projected toward the screen centre: a soft sliver of bore
  // wall shows on the side away from you and shifts as the board scrolls past
  let wallKey = '';
  function depth() {
    const cx = innerWidth / 2, cy = innerHeight / 2, k = 1 - HOLE_S;
    // every measurement first, then every change, so the browser lays the page out once per frame
    const perfRects = surfaceOn ? [] : perfs.map(p => p.el.getBoundingClientRect());
    const wr = win ? win.getBoundingClientRect() : null;
    let under = false;
    if (wr && railOn && railBrand) {
      const a = railBrand.getBoundingClientRect(), b = (railCurrent || railTrack).getBoundingClientRect();
      under = wr.top < b.bottom + 16 && wr.bottom > a.top - 16 && wr.left < a.right + 8;
    }
    const max = document.documentElement.scrollHeight - innerHeight;
    railTarget = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    whereAmI();

    perfRects.forEach((r, i) => {
      if (r.bottom < -60 || r.top > innerHeight + 60) return;
      perfs[i].el.style.setProperty('--bx', ((cx - r.left) * k).toFixed(2) + 'px');
      perfs[i].el.style.setProperty('--by', ((cy - r.top) * k).toFixed(2) + 'px');
    });
    if (wr && wr.bottom > -60 && wr.top < innerHeight + 60) {
      // the far wall of the window shows on the side away from you; written straight onto the
      // window so the panel inside doesn't have to be restyled
      const clamp = v => Math.max(-5, Math.min(5, v));
      const wx = clamp((cx - (wr.left + wr.width / 2)) * 0.01).toFixed(1), wy = clamp((cy - (wr.top + wr.height / 2)) * 0.01).toFixed(1);
      const key = wx + '|' + wy;
      if (key !== wallKey) {
        wallKey = key;
        win.style.boxShadow = `inset ${wx}px ${wy}px 10px -4px var(--wall), inset 0 0 0 1px var(--wall), inset 0 14px 26px -22px rgba(0, 0, 0, .4)`;
      }
    }
    // the window runs nearly edge to edge, so the margin marker steps aside while it passes
    if (railv) railv.classList.toggle('is-under', under);
  }

  /* ------------------------------------------------------------------ loop */

  function frame(now) {
    raf = 0;
    // once nobody is moving the pointer or scrolling, 30 frames a second is plenty for a drifting light
    if (lastPaint && now - lastPaint < 30 && now - lastInput > 700 && !warmFrom) {
      raf = requestAnimationFrame(frame);
      return;
    }
    lastPaint = now;
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    const ease = k => (reduce ? 1 : 1 - Math.pow(1 - k, dt * 60));   // frame-rate independent

    // left alone, the light drifts off across the board; touch or move and it comes straight back.
    // After a minute it stops where it is, so an untouched tab costs nothing.
    const resting = !reduce && now - lastInput > REST_AFTER;
    if (!resting) {
      const wantWander = !reduce && light.on && now - lastInput > WANDER_AFTER;
      if (wantWander) wander += (1 - wander) * ease(0.012); else wander = 0;
      if (wander > 0.0005) {
        const [wx, wy] = wanderAt(now);
        light.tx = cursor.x + (wx - cursor.x) * wander;
        light.ty = cursor.y + (wy - cursor.y) * wander;
      } else {
        light.tx = cursor.x; light.ty = cursor.y;
      }
    }

    light.x += (light.tx - light.x) * ease(0.3);
    light.y += (light.ty - light.y) * ease(0.3);
    const target = light.on ? 1 : 0;
    let busy = false;
    if (warmFrom) {
      // the one orchestrated moment: the lightbox warming up behind the board
      const p = Math.min(1, (now - warmFrom) / WARM_MS), e = 1 - Math.pow(1 - p, 3);
      light.i = target * e;
      light.r = light.tr * (0.62 + 0.38 * e);
      if (p >= 1) warmFrom = 0;
      busy = true;
    } else {
      light.i += (target - light.i) * ease(0.09);
      light.r += (light.tr - light.r) * ease(0.09);
    }
    light.boost *= reduce ? 0 : Math.pow(0.94, dt * 60);

    // current always flows while the board is lit; a fast scroll surges it
    const want = !reduce && light.on && !document.hidden && !resting ? 1 : 0;
    chargeA += (want - chargeA) * (reduce ? 1 : 1 - Math.pow(1 - 0.06, dt * 60));
    if (!want && chargeA < 0.01) chargeA = 0;
    const sv = Math.abs(scrollY - prevSY) / Math.max(dt, 1 / 240);
    prevSY = scrollY;
    const st = Math.min(1.6, sv / 1400);
    surge += (st - surge) * (st > surge ? ease(0.3) : ease(0.035));
    chargeT += dt * (1 + surge * 2);

    if (!reduce && !resting) benchT += dt;
    if (scrollY !== lastScrollY) { lastScrollY = scrollY; depth(); }
    draw();

    // the section marker's charge glides to where you are
    if (railOn && railTrack) {
      const d = railTarget - railP;
      railP = Math.abs(d) < 0.0005 ? railTarget : railP + d * ease(0.14);
      railTrack.style.setProperty('--p', railP.toFixed(4));
    }

    busy = busy
      || Math.abs(light.tx - light.x) > 0.15 || Math.abs(light.ty - light.y) > 0.15
      || Math.abs(target - light.i) > 0.002 || Math.abs(light.tr - light.r) > 0.25
      || light.boost > 0.003 || (wander > 0.0005 && !resting)
      || (chargeA > 0 && light.i > 0.004)
      || (railOn && Math.abs(railTarget - railP) > 0.0005)
      || (!!bench && !reduce && !document.hidden && !resting);
    if (busy) raf = requestAnimationFrame(frame); else lastT = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ------------------------------------------------------------------ input */

  const hint = $('#hint');
  let travelled = 0, lastPX = null, lastPY = null;
  const hideHint = () => { if (hint) hint.classList.add('is-done'); };
  function noteMove(x, y) {
    if (!hint || hint.classList.contains('is-done')) return;
    if (lastPX !== null) travelled += Math.hypot(x - lastPX, y - lastPY);
    lastPX = x; lastPY = y;
    if (travelled > 260) hideHint();
  }
  // anything the visitor does counts: the light comes back and the nudging stops
  function active() {
    lastInput = performance.now();
    if (isIdle) { isIdle = false; root.classList.remove('is-idle'); }
    kick();
  }

  if (fine) {
    addEventListener('pointermove', e => {
      cursor.x = e.clientX; cursor.y = e.clientY;
      noteMove(e.clientX, e.clientY);
      active();
    }, { passive: true });
  }
  const onTouch = e => {
    const t = e.touches[0];
    if (!t) return;
    cursor.x = t.clientX; cursor.y = t.clientY;
    hideHint(); active();
  };
  addEventListener('touchstart', onTouch, { passive: true });
  addEventListener('touchmove', onTouch, { passive: true });
  addEventListener('scroll', active, { passive: true });   // the board slides over a still light
  addEventListener('wheel', active, { passive: true });
  addEventListener('keydown', active, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  if (mqReduce.addEventListener) mqReduce.addEventListener('change', e => { reduce = e.matches; kick(); });

  // when nobody has touched anything for a while, the call to action starts to pulse
  setInterval(() => {
    const idle = !reduce && !document.hidden && performance.now() - lastInput > NUDGE_AFTER;
    if (idle !== isIdle) { isIdle = idle; root.classList.toggle('is-idle', idle); }
  }, 700);

  // the power LED flickers with activity, like a real board's
  const leds = $$('.pwr .led');
  const blink = () => {
    if (reduce) return;
    leds.forEach(l => { l.classList.remove('is-blink'); void l.offsetWidth; l.classList.add('is-blink'); });
  };
  document.addEventListener('pointerdown', blink, { passive: true });
  addEventListener('keydown', e => { if (!e.repeat) blink(); });

  const backlights = $$('[data-backlight]');
  function setBacklight(on, quiet) {
    light.on = on;
    backlights.forEach(b => b.setAttribute(b.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', String(on)));
    if (!quiet) store.set('nyna-draft-backlight', on ? 'on' : 'off');
    active();
  }
  backlights.forEach(b => b.addEventListener('click', () => setBacklight(!light.on)));

  /* ------------------------------------------------------------------ theme */

  const themeMeta = $('meta[name="theme-color"]');
  const themeToggles = $$('[data-theme-toggle]');
  function paintTheme() {
    pal = PALETTE[theme];
    themeToggles.forEach(b => b.setAttribute('aria-checked', String(theme === 'dark')));
    if (themeMeta) themeMeta.setAttribute('content', pal.meta);
    if (bench) bench.theme();
    cacheKey = '';                                     // copper colours changed
  }
  function applyTheme(next, save) {
    theme = next;
    root.setAttribute('data-theme', next);
    if (save) store.set(THEME_KEY, next);
    paintTheme();
    draw();
  }
  // the new mask spreads out from the switch you pressed
  function setTheme(next, from) {
    if (next === theme) return;
    if (!document.startViewTransition || reduce || !from) { applyTheme(next, true); active(); return; }
    const r = from.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const vt = document.startViewTransition(() => applyTheme(next, true));
    vt.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: 620, easing: 'cubic-bezier(.16, 1, .3, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
    vt.finished.finally(active);
  }
  themeToggles.forEach(b => b.addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark', b)));
  // follow the system setting until the visitor picks one
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  if (mqDark.addEventListener) mqDark.addEventListener('change', e => {
    if (store.get(THEME_KEY)) return;
    applyTheme(e.matches ? 'dark' : 'light', false); active();
  });
  paintTheme();

  /* ------------------------------------------------------------------ honeycomb */

  // whole hexes only: each field gets its own mask sized to fit, like a real board edge.
  // The back opening uses the same hexes, softened, so the bore wall reads as shading.
  function buildPerfs() {
    perfs.length = 0;
    $$('.perf').forEach(el => {
      const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight);
      if (w < 30 || h < 30) return;
      const sp = 15, r = 11.4, m = 3;
      const hw = r * Math.sqrt(3) / 2, dx = Math.sqrt(3) * sp, dy = 1.5 * sp;
      const rows = Math.max(1, Math.floor((h - 2 * m - 2 * r) / dy) + 1);
      const cols = Math.max(1, Math.floor((w - 2 * m - 2 * hw - dx / 2) / dx) + 1);
      const offY = (h - ((rows - 1) * dy + 2 * r)) / 2 + r;
      const offX = (w - ((cols - 1) * dx + dx / 2 + 2 * hw)) / 2 + hw;
      const f = n => Math.round(n * 10) / 10;
      let d = '';
      for (let row = 0; row < rows; row++) {
        const cy = offY + row * dy, shift = row % 2 ? dx / 2 : 0;
        for (let c = 0; c < cols; c++) {
          const cx = offX + shift + c * dx;
          d += `M${f(cx + hw)} ${f(cy + r / 2)}L${f(cx)} ${f(cy + r)}L${f(cx - hw)} ${f(cy + r / 2)}L${f(cx - hw)} ${f(cy - r / 2)}L${f(cx)} ${f(cy - r)}L${f(cx + hw)} ${f(cy - r / 2)}Z`;
        }
      }
      const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
      const front = `${head}<path d="${d}"/></svg>`;
      const back = `${head}<filter id="s" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.4"/></filter><path filter="url(#s)" d="${d}"/></svg>`;
      el.style.setProperty('--hexmask', `url("data:image/svg+xml,${encodeURIComponent(front)}")`);
      el.style.setProperty('--hexback', `url("data:image/svg+xml,${encodeURIComponent(back)}")`);
      el.style.setProperty('--mw', w + 'px');
      el.style.setProperty('--mh', h + 'px');
      el.style.setProperty('--bw', (w * HOLE_S).toFixed(2) + 'px');
      el.style.setProperty('--bh', (h * HOLE_S).toFixed(2) + 'px');
      el.style.setProperty('--mrep', 'no-repeat');
      const cells = [];
      for (let row = 0; row < rows; row++) {
        const cy = offY + row * dy, shift = row % 2 ? dx / 2 : 0;
        for (let c = 0; c < cols; c++) cells.push([offX + shift + c * dx, cy]);
      }
      perfs.push({ el, cells, r, hw });
    });
  }

  /* ------------------------------------------------------------------ side honeycomb */

  // The vertical honeycomb beside a heading runs from the gap above it down to just above
  // the content that follows (on a case study, from the back link down to the first picture).
  function sizeSides() {
    $$('.perf--side').forEach(el => {
      el.style.removeProperty('--side-top');
      el.style.removeProperty('--side-h');
      if (getComputedStyle(el).display === 'none') return;
      const host = el.parentElement, head = host.querySelector('.sec-head, .case-head');
      if (!head) return;
      const hr = host.getBoundingClientRect(), h = head.getBoundingClientRect(), back = host.querySelector('.back');
      const top = back ? back.getBoundingClientRect().top - hr.top : Math.max(0, (h.top - hr.top) - Math.min(110, (h.top - hr.top) * 0.55));
      // run on past the heading, down to just above whatever comes next
      const next = el.nextElementSibling;
      const nb = next ? next.getBoundingClientRect().top - hr.top - 44 : 0;
      const bottom = Math.max(h.bottom - hr.top, nb);
      el.style.setProperty('--side-top', top.toFixed(0) + 'px');
      el.style.setProperty('--side-h', Math.max(180, bottom - top).toFixed(0) + 'px');
    });
  }

  /* ------------------------------------------------------------------ the surface */

  // The board's top face, drawn as one shape with the honeycomb and the work window cut
  // right through it, so whatever is behind the board (the moving bench) shows in the holes.
  // A thin shadow inside the top edge of every hole is the thickness of the board.
  const WALL = 2.2;
  function buildSurface() {
    surfaceSvg = null; holes = [];
    if (!surfaceOn || !net) return;
    const br = board.getBoundingClientRect(), W = net.W, H = net.H;
    const f = n => Math.round(n * 10) / 10;
    const hex = (cx, cy, r, hw) => `M${f(cx + hw)} ${f(cy + r / 2)}L${f(cx)} ${f(cy + r)}L${f(cx - hw)} ${f(cy + r / 2)}L${f(cx - hw)} ${f(cy - r / 2)}L${f(cx)} ${f(cy - r)}L${f(cx + hw)} ${f(cy - r / 2)}Z`;
    const rrect = (x, y, w, h, q) => `M${f(x + q)} ${f(y)}H${f(x + w - q)}A${q} ${q} 0 0 1 ${f(x + w)} ${f(y + q)}V${f(y + h - q)}A${q} ${q} 0 0 1 ${f(x + w - q)} ${f(y + h)}H${f(x + q)}A${q} ${q} 0 0 1 ${f(x)} ${f(y + h - q)}V${f(y + q)}A${q} ${q} 0 0 1 ${f(x + q)} ${f(y)}Z`;
    let cut = '', lip = '';
    for (const p of perfs) {
      const r = p.el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const x0 = r.left - br.left, y0 = r.top - br.top;
      for (const [cx, cy] of p.cells) {
        const d = hex(x0 + cx, y0 + cy, p.r, p.hw);
        cut += d; lip += hex(x0 + cx, y0 + cy + WALL, p.r, p.hw);
        holes.push({ y0: y0 + cy - p.r, y1: y0 + cy + p.r, d });
      }
    }
    // routed windows: the work panel's window, and any other element marked as a hole
    $$('[data-hole]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const q = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12;
      const x0 = r.left - br.left, y0 = r.top - br.top, d = rrect(x0, y0, r.width, r.height, q);
      cut += d; lip += rrect(x0, y0 + WALL, r.width, r.height, q);
      holes.push({ y0, y1: y0 + r.height, d });
    });
    const all = `M0 0H${W}V${H}H0Z`;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'surface');
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<defs><clipPath id="surface-holes"><path d="${cut}"/></clipPath></defs>`
      + `<path class="s-fill" d="${all}${cut}"/>`
      + `<path class="s-wall" clip-path="url(#surface-holes)" d="${all}${lip}"/>`;
    surfaceSvg = svg;
  }

  /* ------------------------------------------------------------------ the bench */

  // What the board sits on: a dark light-table with slow contour lines drifting across it,
  // and the backlight shining up from underneath. WebGL draws it once for the whole screen;
  // it shows around the board and through every hole cut in it.
  function makeBench() {
    const cv = $('#bench');
    if (!cv) return null;
    let gl = null;
    try { gl = cv.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' }); } catch (e) { gl = null; }
    if (!gl) return null;
    const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
    const FS = `precision highp float;
uniform vec2 uRes, uView; uniform float uT, uScroll, uLI, uLineA; uniform vec3 uLight, uBench, uLine;
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;} vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
float snoise(vec2 v){const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
 vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx); vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
 vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod289(i);
 vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
 vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.); m=m*m; m=m*m;
 vec3 x=2.*fract(p*C.www)-1.; vec3 h=abs(x)-.5; vec3 ox=floor(x+.5); vec3 a0=x-ox;
 m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
 vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw; return 130.*dot(m,g);}
float fbm(vec2 p){float s=0.,a=.55; for(int i=0;i<3;i++){s+=a*snoise(p); p*=2.02; a*=.5;} return s;}
float fbm2(vec2 p){return .55*snoise(p)+.275*snoise(p*2.02);}
vec4 lamp(float r){
 vec4 c0=vec4(.933,.984,1.,1.), c1=vec4(.643,.898,.988,.95), c2=vec4(.369,.812,.976,.78), c3=vec4(.047,.561,.796,.34), c4=vec4(.047,.561,.796,0.);
 if(r<.16) return mix(c0,c1,r/.16);
 if(r<.4) return mix(c1,c2,(r-.16)/.24);
 if(r<.7) return mix(c2,c3,(r-.4)/.3);
 return mix(c3,c4,clamp((r-.7)/.3,0.,1.));}
void main(){
 vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)*(uView.x/uRes.x);
 vec2 p=(css+vec2(0.,uScroll*.22))/uView.y-vec2(.5*uView.x/uView.y,.5);
 float t=uT*.012;
 vec2 q=vec2(fbm2(p*.85+vec2(0.,t)),fbm2(p*.85+vec2(5.2,-t)));
 float n=fbm(p+1.5*q+vec2(t*.6,-t*.4));
 float v=n*1.6+t*1.2;
 float lines=1.-smoothstep(0.,.2,abs(fract(v)-.5));
 float field=smoothstep(-.3,.9,n);
 vec3 col=uBench+uLine*(field*.05+lines*uLineA);
 float r=length(css-uLight.xy)/max(uLight.z,1.);
 vec4 L=lamp(r);
 col=mix(col,L.rgb,L.a*uLI*.62);
 col+=uLine*lines*.2*uLI*(1.-smoothstep(0.,1.,r));
 gl_FragColor=vec4(col,1.);}`;
    let prog = null, U = {}, view = [innerWidth, innerHeight], lost = false, colBench = [0.1, 0.13, 0.17], lineA = 0.1;
    function init() {
      const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null; };
      const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
      if (!v || !f) return false;
      prog = gl.createProgram();
      gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      ['uRes', 'uView', 'uT', 'uScroll', 'uLI', 'uLineA', 'uLight', 'uBench', 'uLine'].forEach(k => { U[k] = gl.getUniformLocation(prog, k); });
      gl.uniform3f(U.uLine, 0.36, 0.8, 0.98);
      return true;
    }
    if (!init()) return null;
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
    cv.addEventListener('webglcontextrestored', () => { lost = !init(); api.theme(); api.resize(); });
    const api = {
      resize() {
        const w = cv.clientWidth || innerWidth, h = cv.clientHeight || innerHeight;
        const k = Math.min(1.5, window.devicePixelRatio || 1) * 0.42;   // it's soft and mostly seen through holes
        const bw = Math.max(1, Math.round(w * k)), bh = Math.max(1, Math.round(h * k));
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
        view = [w, h];
        if (!lost) gl.viewport(0, 0, bw, bh);
      },
      theme() {
        const hex = getComputedStyle(root).getPropertyValue('--bench').trim().replace('#', '');
        if (hex.length === 6) colBench = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
        lineA = theme === 'dark' ? 0.085 : 0.11;
      },
      draw(t, lx, ly, lr, li) {
        if (lost) return;
        gl.uniform2f(U.uRes, cv.width, cv.height);
        gl.uniform2f(U.uView, view[0], view[1]);
        gl.uniform1f(U.uT, t);
        gl.uniform1f(U.uScroll, 0);
        gl.uniform1f(U.uLI, li);
        gl.uniform1f(U.uLineA, lineA);
        gl.uniform3f(U.uLight, lx, ly, lr);
        gl.uniform3f(U.uBench, colBench[0], colBench[1], colBench[2]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
    api.theme(); api.resize();
    addEventListener('resize', () => { api.resize(); kick(); }, { passive: true });
    return api;
  }

  /* ------------------------------------------------------------------ cursor */

  // A probe tip that sits exactly on the pointer, and a ring that follows a moment behind.
  // Over links and buttons the ring opens up; over the project panel it says what a drag
  // or a click will do. Text fields keep the normal text cursor.
  const cursorEl = $('#cursor');
  if (cursorEl && fine) {
    const dot = $('.cursor-dot', cursorEl), ring = $('.cursor-ring', cursorEl), label = $('.cursor-label', cursorEl);
    $$('.pcb-link').forEach(a => { a.dataset.cursor = 'View'; });
    const pnl = $('#panel');
    if (pnl) pnl.dataset.cursor = 'Drag';
    root.classList.add('has-cursor');
    let x = 0, y = 0, rx = 0, ry = 0, seen = false, loop = 0, last = 0, lastEl = null;
    const put = (el, px, py) => { el.style.transform = `translate3d(${px}px,${py}px,0)`; };
    const follow = now => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const k = reduce ? 1 : 1 - Math.pow(1 - 0.3, dt * 60);
      rx += (x - rx) * k; ry += (y - ry) * k;
      put(ring, rx, ry);
      if (Math.abs(x - rx) + Math.abs(y - ry) > 0.1) loop = requestAnimationFrame(follow);
      else { loop = 0; last = 0; }
    };
    const setState = el => {
      if (el === lastEl) return;
      lastEl = el;
      const at = sel => (el && el.closest ? el.closest(sel) : null);
      const text = at('input, textarea, select, [contenteditable="true"]');
      const tagged = !text && at('[data-cursor]');
      const link = !text && !tagged && at('a[href], button, [role="switch"], label');
      cursorEl.classList.toggle('is-text', !!text);
      cursorEl.classList.toggle('is-label', !!tagged);
      cursorEl.classList.toggle('is-link', !!link);
      if (tagged) label.textContent = tagged.dataset.cursor;
    };
    addEventListener('pointermove', e => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      x = e.clientX; y = e.clientY;
      if (!seen) { seen = true; rx = x; ry = y; put(ring, x, y); }
      cursorEl.classList.add('is-on');
      put(dot, x, y);
      setState(e.target);
      if (!loop) loop = requestAnimationFrame(follow);
    }, { passive: true });
    document.addEventListener('mouseout', e => { if (!e.relatedTarget) cursorEl.classList.remove('is-on'); });
    addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') cursorEl.classList.add('is-down'); }, { passive: true });
    addEventListener('pointerup', () => cursorEl.classList.remove('is-down'), { passive: true });
    // the page moved under a still pointer, so what's under it may have changed
    let sq = 0;
    addEventListener('scroll', () => {
      if (!seen || sq) return;
      sq = requestAnimationFrame(() => { sq = 0; setState(document.elementFromPoint(x, y)); });
    }, { passive: true });
  }

  /* ------------------------------------------------------------------ board viewer */

  const vImg = $('#viewer-img'), vTabs = $$('.viewer-tabs button');
  if (vImg && vTabs.length) {
    let cur = 'systems';
    const cache = {};
    const src = key => `/draft/assets/boards/${key}.webp?v=2`;
    const load = key => cache[key] || (cache[key] = new Promise(res => {
      const im = new Image();
      im.onload = im.onerror = () => res();
      im.src = src(key);
    }));
    vTabs.forEach(b => b.addEventListener('click', () => {
      const key = b.dataset.board;
      if (key === cur) return;
      cur = key;
      vTabs.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      // the old board goes out of focus, the new one comes into it
      vImg.classList.add('is-out');
      const wait = new Promise(r => setTimeout(r, reduce ? 0 : 200));
      Promise.all([load(key), wait]).then(() => {
        if (cur !== key) return;
        vImg.width = +b.dataset.w; vImg.height = +b.dataset.h;
        vImg.alt = b.dataset.alt; vImg.src = src(key);
        const show = () => requestAnimationFrame(() => requestAnimationFrame(() => vImg.classList.remove('is-out')));
        if (vImg.decode) vImg.decode().then(show, show); else show();
      });
    }));
    const idle = window.requestIdleCallback ? cb => requestIdleCallback(cb, { timeout: 4000 }) : cb => setTimeout(cb, 2500);
    idle(() => vTabs.forEach(b => load(b.dataset.board)));

    // the board tips toward the cursor, like turning it over in your hand
    const vStage = $('#viewer-stage'), vTilt = $('#viewer-tilt');
    if (fine && vStage && vTilt) {
      vStage.addEventListener('pointermove', e => {
        if (reduce) return;
        const r = vStage.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
        vTilt.style.setProperty('--ry', (nx * 12).toFixed(2) + 'deg');
        vTilt.style.setProperty('--rx', (-ny * 9).toFixed(2) + 'deg');
      });
      vStage.addEventListener('pointerleave', () => {
        vTilt.style.setProperty('--ry', '0deg');
        vTilt.style.setProperty('--rx', '0deg');
      });
    }
  }

  /* ------------------------------------------------------------------ work panel */

  const panel = $('#panel'), track = $('#track');
  if (panel && track) {
    const boards = $$('.pcb', track);
    const prev = $('[data-panel-prev]'), next = $('[data-panel-next]');
    let tx = 0, anim = 0, drag = null, suppress = false, touched = false;

    const maxScroll = () => Math.max(0, panel.scrollWidth - panel.clientWidth);
    const snaps = () => {
      const tl = track.getBoundingClientRect().left;
      const pad = parseFloat(getComputedStyle(track).paddingLeft) || 0, m = maxScroll();
      const s = boards.map(b => Math.round(Math.min(m, Math.max(0, b.getBoundingClientRect().left - tl - pad))));
      s.push(Math.round(m));
      return Array.from(new Set(s)).sort((a, b) => a - b);
    };
    // the soft edges only appear on a side that still has boards hidden past it
    const edges = () => {
      if (!win) return;
      const m = maxScroll(), s = panel.scrollLeft - tx;
      win.style.setProperty('--bl', Math.max(0, Math.min(1, s / 70)).toFixed(3));
      win.style.setProperty('--br', Math.max(0, Math.min(1, (m - s) / 70)).toFixed(3));
    };
    // V is the virtual position: scrollLeft, plus any rubber-band overshoot shown as a transform
    function apply(V) {
      const m = maxScroll();
      let t = 0;
      if (V < 0) { t = -V; V = 0; } else if (V > m) { t = -(V - m); V = m; }
      panel.scrollLeft = V;
      if (t !== tx) { tx = t; track.style.transform = t ? `translate3d(${t.toFixed(2)}px,0,0)` : ''; }
    }
    function updateArrows() {
      const m = maxScroll();
      if (prev) prev.disabled = panel.scrollLeft <= 2;
      if (next) next.disabled = panel.scrollLeft >= m - 2;
    }
    const rubber = (o, dim) => (o * dim * 0.55) / (dim + 0.55 * o);          // soft edge, not a wall
    const project = v => (v / 1000) * 0.998 / (1 - 0.998);                   // where a flick would coast to

    // critically damped spring from the live position, carrying the release velocity
    function springTo(target, v0) {
      cancelAnimationFrame(anim);
      if (reduce) { apply(target); anim = 0; panel.classList.remove('is-dragging'); updateArrows(); return; }
      const w = 2 * Math.PI / 0.42;
      let V = panel.scrollLeft - tx, v = v0, last = performance.now();
      panel.classList.add('is-dragging');
      const step = now => {
        const dt = Math.min(0.032, (now - last) / 1000);
        last = now;
        v += (-w * w * (V - target) - 2 * w * v) * dt;
        V += v * dt;
        apply(V);
        if (Math.abs(V - target) < 0.5 && Math.abs(v) < 10) {
          apply(target); anim = 0; panel.classList.remove('is-dragging'); updateArrows(); return;
        }
        anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }

    ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach(t => panel.addEventListener(t, () => { touched = true; }, { passive: true }));
    panel.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;      // touch and trackpads scroll natively
      cancelAnimationFrame(anim); anim = 0;
      drag = { id: e.pointerId, x0: e.clientX, V0: panel.scrollLeft - tx, lx: e.clientX, lt: e.timeStamp, v: 0, moved: 0, on: false };
    });
    panel.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0;
      if (!drag.on) {
        if (Math.abs(dx) < 6) return;                                  // a little travel before it counts as a drag
        drag.on = true;
        panel.setPointerCapture(e.pointerId);
        panel.classList.add('is-dragging');
      }
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      const m = maxScroll(), dim = panel.clientWidth;
      let V = drag.V0 - dx;                                              // 1:1 with the pointer
      if (V < 0) V = -rubber(-V, dim); else if (V > m) V = m + rubber(V - m, dim);
      apply(V);
      const dt = e.timeStamp - drag.lt;
      if (dt > 0) drag.v = drag.v * 0.2 + (-(e.clientX - drag.lx) / dt * 1000) * 0.8;
      drag.lx = e.clientX; drag.lt = e.timeStamp;
    });
    const release = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.on) return;
      suppress = d.moved > 6;
      const v = e.timeStamp - d.lt > 80 ? 0 : d.v;                       // paused before letting go: no throw
      const projected = panel.scrollLeft - tx + project(v);
      let target = 0, best = Infinity;
      for (const p of snaps()) { const dd = Math.abs(p - projected); if (dd < best) { best = dd; target = p; } }
      springTo(target, v);
    };
    panel.addEventListener('pointerup', release);
    panel.addEventListener('pointercancel', release);
    panel.addEventListener('click', e => { if (suppress) { e.preventDefault(); e.stopPropagation(); suppress = false; } }, true);
    panel.addEventListener('dragstart', e => e.preventDefault());

    function page(dir) {
      touched = true;
      const s = snaps(), V = panel.scrollLeft, step = panel.clientWidth * 0.66;
      let target = 0;
      if (dir > 0) { target = s[s.length - 1]; for (const p of s) if (p >= V + step) { target = p; break; } }
      else { for (const p of s) if (p <= V - step) target = p; }
      springTo(target, 0);
    }
    if (prev) prev.addEventListener('click', () => page(-1));
    if (next) next.addEventListener('click', () => page(1));
    panel.addEventListener('scroll', () => { edges(); litDirty = true; kick(); if (!anim) updateArrows(); }, { passive: true });
    addEventListener('resize', edges, { passive: true });
    updateArrows();
    edges();

    // the first time the panel comes into view it gives a little nudge, so it reads as something you can move
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setTimeout(() => { if (!touched && !reduce && panel.scrollLeft < 2) springTo(0, 1700); }, 450);
      }, { threshold: 0.55 });
      io.observe(panel);
    }
  }

  /* ------------------------------------------------------------------ enquiry */

  const form = $('#enquiry');
  if (form) {
    const fName = $('#f-name'), fEmail = $('#f-email'), fMsg = $('#f-msg'), status = $('#status');
    const emailErr = $('#f-email-err');
    const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    const setErr = (field, on) => {
      field.setAttribute('aria-invalid', on ? 'true' : 'false');
      const err = $('#' + field.id + '-err');
      if (err) err.hidden = !on;
    };
    const checkEmail = () => {
      const v = fEmail.value.trim();
      emailErr.textContent = v ? 'That email address looks incomplete.' : 'Add an email address so we can reply.';
      return validEmail(v);
    };

    $$('.dip-sw', form).forEach(b => b.addEventListener('click', () => {
      b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true'));
    }));
    fEmail.addEventListener('blur', () => { if (fEmail.value.trim()) setErr(fEmail, !checkEmail()); });
    fEmail.addEventListener('input', () => { if (fEmail.getAttribute('aria-invalid') === 'true' && checkEmail()) setErr(fEmail, false); });
    fMsg.addEventListener('input', () => { if (fMsg.getAttribute('aria-invalid') === 'true' && fMsg.value.trim()) setErr(fMsg, false); });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const email = fEmail.value.trim(), msg = fMsg.value.trim(), name = fName.value.trim();
      const badEmail = !checkEmail(), badMsg = !msg;
      setErr(fEmail, badEmail); setErr(fMsg, badMsg);
      if (badEmail) { fEmail.focus(); return; }
      if (badMsg) { fMsg.focus(); return; }

      const services = $$('.dip-sw[aria-checked="true"]', form).map(b => b.dataset.service);
      const subject = 'Project enquiry' + (services.length ? ': ' + services.join(', ') : '');
      const lines = [msg, ''];
      if (services.length) lines.push('Services: ' + services.join(', '));
      if (name) lines.push('From: ' + name);
      lines.push('Reply to: ' + email);
      window.location.href = 'mailto:info@nyna.co.uk?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
      status.textContent = 'Your email app should open with the enquiry ready. Press send there to deliver it.';
      if (light.on && !reduce) { light.boost = 1.1; active(); }     // the board lights up as it goes
    });
  }

  /* ------------------------------------------------------------------ floating control */

  const floatEl = $('#float'), nav = $('#nav');
  if (floatEl && nav && 'IntersectionObserver' in window) {
    const focusables = $$('a, button', floatEl);
    new IntersectionObserver(([entry]) => {
      const on = !entry.isIntersecting;
      floatEl.classList.toggle('is-on', on);
      floatEl.setAttribute('aria-hidden', String(!on));
      focusables.forEach(x => { x.tabIndex = on ? 0 : -1; });
    }).observe(nav);
  }

  /* ------------------------------------------------------------------ menu popover */

  const pop = $('#menu');
  const openers = $$('[data-menu-open]');
  if (pop && openers.length) {
    let from = null, openY = 0, outT = 0, clock = 0;
    const ldn = $('#ldn-time', pop);
    let fmt = null;
    try { fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }); } catch (e) { /* no time zone data */ }
    const tick = () => { if (ldn && fmt) ldn.textContent = fmt.format(new Date()); };
    const isOpen = () => !pop.hidden && !pop.classList.contains('is-out');
    function open(btn) {
      clearTimeout(outT);
      from = btn;
      tick();
      clearInterval(clock); clock = setInterval(tick, 15000);
      pop.hidden = false;
      pop.classList.remove('is-out', 'is-in');
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth;
      const right = Math.max(12, innerWidth - r.right);
      pop.style.top = Math.round(r.bottom + 10) + 'px';
      pop.style.right = Math.round(right) + 'px';
      // grow out of the button that was pressed
      const bx = r.left + r.width / 2 - (innerWidth - right - w);
      pop.style.setProperty('--ox', Math.max(16, Math.min(w - 16, bx)).toFixed(0) + 'px');
      void pop.offsetWidth;
      pop.classList.add('is-in');
      openers.forEach(b => b.setAttribute('aria-expanded', String(b === btn)));
      openY = scrollY;
      const first = $('.pop-nav a', pop);
      if (first) first.focus({ preventScroll: true });
    }
    function close(restore) {
      if (!isOpen()) return;
      clearInterval(clock);
      pop.classList.remove('is-in');
      pop.classList.add('is-out');
      openers.forEach(b => b.setAttribute('aria-expanded', 'false'));
      outT = setTimeout(() => { pop.hidden = true; pop.classList.remove('is-out'); }, reduce ? 0 : 160);
      if (restore && from) from.focus({ preventScroll: true });
    }
    openers.forEach(b => b.addEventListener('click', () => { if (isOpen() && from === b) close(false); else open(b); }));
    document.addEventListener('pointerdown', e => {
      if (!isOpen() || pop.contains(e.target) || openers.some(b => b.contains(e.target))) return;
      close(false);
    });
    addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(true); });
    pop.addEventListener('focusout', e => {
      const to = e.relatedTarget;
      if (to && !pop.contains(to) && !openers.includes(to)) close(false);
    });
    $$('.pop-nav a', pop).forEach(a => a.addEventListener('click', () => close(false)));
    addEventListener('scroll', () => { if (isOpen() && Math.abs(scrollY - openY) > 90) close(false); }, { passive: true });
    addEventListener('resize', () => close(false));
  }

  /* ------------------------------------------------------------------ where you are */

  // the margin marker: new labels slide in along the reading direction as the old ones slide out
  function railSay(text) {
    if (!railLabels || (railCurrent && railCurrent.textContent === text)) return;
    const el = document.createElement('span');
    el.className = 'rail-v-label is-enter';
    el.textContent = text;
    railLabels.appendChild(el);
    const old = railCurrent;
    railCurrent = el;
    if (reduce) { el.classList.remove('is-enter'); if (old) old.remove(); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-enter')));
    if (old) { old.classList.add('is-leave'); setTimeout(() => old.remove(), 800); }
  }
  // the section you're in is the last one whose top has passed the middle of the screen
  // (so at the footer it is still the last section), which stays right even after a jump
  let currentSec = '';
  function whereAmI() {
    let sec = null;
    for (const s of sections) { if (s.getBoundingClientRect().top <= innerHeight / 2) sec = s; else break; }
    if (!sec || sec.id === currentSec) return;
    currentSec = sec.id;
    popLinks.forEach(a => { if (a.dataset.sec === currentSec) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    if (!railv) return;
    const label = sec.dataset.label || '';
    railv.classList.toggle('is-on', !!label);
    if (label) railSay(label);
  }

  /* ------------------------------------------------------------------ arrivals */

  // headings come into focus word by word, parts are placed onto their pads, test points
  // are probed in turn, parts lists are drawn in, client marks print across
  if (!reduce && 'IntersectionObserver' in window) {
    root.classList.add('reveals');
    $$('.h2').forEach(h => {
      const words = h.textContent.trim().split(/\s+/);
      h.textContent = '';
      words.forEach((w, i) => {
        const s = document.createElement('span');
        s.className = 'w';
        s.style.setProperty('--i', i);
        s.textContent = w;
        h.appendChild(s);
        if (i < words.length - 1) h.appendChild(document.createTextNode(' '));
      });
    });
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
    $$('.sec-head, .work-head, .hw-copy, .contact-intro, .chip, .tps, .bom, .quote').forEach(el => io.observe(el));
  }

  // bullets light when pointed at (CSS :hover); without hover, the ones crossing the middle of the screen light
  if (!fine && 'IntersectionObserver' in window) {
    const lit = new IntersectionObserver(es => {
      for (const e of es) e.target.classList.toggle('is-lit', e.isIntersecting);
    }, { rootMargin: '-42% 0px -42% 0px' });
    $$('.chip-inc li, .bom li, .feat, .leds li').forEach(el => lit.observe(el));
  }

  // looping trace animations only run while they're on screen
  if ('IntersectionObserver' in window) {
    const live = new IntersectionObserver(es => { for (const e of es) e.target.classList.toggle('is-live', e.isIntersecting); });
    $$('.tps, .pipeline').forEach(el => live.observe(el));
  }

  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* ------------------------------------------------------------------ start */

  function rebuild() {
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    railOn = !!railv && getComputedStyle(railv).display !== 'none';
    sizeSides();
    generate();
    buildPerfs();
    buildSurface();
    buildTiles();
    watchLight();
    lastScrollY = -1;
    depth();
    railP = railTarget;
    light.tr = baseR();
    kick();
  }
  let rt = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const r = board.getBoundingClientRect();
      if (net && Math.round(r.width) === net.W && Math.round(r.height) === net.H) return;
      rebuild();
    }, 150);
  });

  function start() {
    // the moving bench needs WebGL; without it the holes keep their plain CSS light
    bench = makeBench();
    surfaceOn = !!bench;
    root.classList.toggle('has-surface', surfaceOn);
    rebuild();
    ro.observe(board);
    setBacklight(light.on, true);
    root.classList.add('is-ready');                  // the headline resolves as the light warms up
    lastInput = performance.now();
    if (reduce) { light.i = light.on ? 1 : 0; light.r = light.tr; kick(); }
    else setTimeout(() => { warmFrom = performance.now(); lastInput = warmFrom; kick(); }, 280);
  }
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(start);
})();
