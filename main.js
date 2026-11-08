/* NYNA: "Backlit"
   The page is NYNA's board and the cursor is a light held behind it.
   Two copper layers are routed around the real layout (all content is a keep-out):
   the top layer sharp, an inner layer softer and set deeper. The routing shows
   faintly through the mask everywhere, and vividly wherever the light is, with
   small charges running along the traces. Leave the page alone and the light
   wanders across the board by itself. Holes (honeycomb, mounting holes, the work
   window, mouse bites) are CSS and show the light directly, with soft bore walls
   that shift as you scroll. On a touch screen there is no light to hold: the
   current simply runs through all of the copper on screen, steadily, by itself.
   Printed on the board, in a slot before each section, are rows of real circuits
   that run on their own: supplies, a clock, the optical link, drivers, sensors. */
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
  // no pointer to hold a light with: no glow, just the current flowing through the board
  const flow = !fine;
  if (flow) root.classList.add('flow');

  // iOS ignores background-attachment: fixed, so holes fall back to the plain bench there.
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (iOS) root.classList.add('no-fixed-bg');

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: still works this visit */ } }
  };

  const TAU = Math.PI * 2;
  const THEME_KEY = 'nyna-theme';
  const IN_S = 0.991;          // inner copper sits deeper in the board: projected toward the screen centre
  const HOLE_S = 0.993;        // the far side of a drilled hole, likewise (kept shallow: a hint, not a trench)
  const WANDER_AFTER = 2600;   // ms without input before the light starts wandering on its own
  const NUDGE_AFTER = 6000;    // ms without input before the call to action starts pulsing
  const REST_AFTER = 60000;    // ms without input before everything settles and the animation loop stops
  const FLOW_REST = 180000;    // the same on a touch screen, where the current is the whole show
  const WARM_MS = 1500;
  const NS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------ palettes */

  // what the light does to each board: FR4 glow, copper, drills, and the charges
  const PALETTE = {
    light: {
      glow: [[0, '150,226,255', 0.62], [0.32, '80,206,255', 0.4], [0.64, '0,142,219', 0.13], [1, '0,142,219', 0]],
      copper: 'rgb(0, 76, 158)', inner: 'rgb(0, 112, 200)', innerAlpha: 0.5,
      drill: 'rgb(226, 247, 255)', fall: [0.8, 0.5],
      head: '255,255,255', halo: '0,150,255', tail: '0,122,235',
      run: { head: '0,104,200', halo: '31,192,255', tail: '0,150,240' },
      meta: '#122236'
    },
    dark: {
      glow: [[0, '31,192,255', 0.3], [0.35, '0,140,240', 0.18], [0.7, '0,92,200', 0.07], [1, '0,92,200', 0]],
      copper: 'rgb(31, 192, 255)', inner: 'rgb(0, 130, 220)', innerAlpha: 0.66,
      drill: 'rgb(6, 10, 17)', fall: [0.9, 0.56],
      head: '255,255,255', halo: '31,192,255', tail: '140,222,255',
      run: { head: '214,243,255', halo: '31,192,255', tail: '31,192,255' },
      meta: '#05090F'
    }
  };

  /* ------------------------------------------------------------------ state */

  let theme = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  let pal = PALETTE[theme];
  let net = null, ghost = null;
  let tiles = [];
  let dpr = Math.min(1.5, window.devicePixelRatio || 1);
  let cacheKey = '';
  const vis = { top: [], inner: [], run: [] };
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
    const sel = surfaceOn ? '.mhole, .brand-v, .tab, .tp-pad, .pin-pad' : '.mhole, .perf, .brand-v, .window, .tab, .tp-pad, .pin-pad, .model-stage';
    litDirty = true;
    $$(sel).forEach(el => { if (litIO) litIO.observe(el); else litEls.add(el); });
  }
  const perfs = [];
  let surfaceOn = false, surfaceSvg = null, silkSvg = null, holes = [];
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
    on: store.get('nyna-backlight') !== 'off'
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
            const y0 = side < 0 ? top - 12 : bottom + 12, out = x < mid ? -1 : 1;
            const l1 = 12, l2 = 12, l3 = 0;
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
            if (t.L > 20 && rnd() < (flow ? 0.7 : 0.45)) t.ch = [charge(rnd, t.L, 24 + rnd() * 30, undefined, t.L + 40 + rnd() * 140, false)];
            traces.push(t);
          }
        }
      });
    }

    // 1b. the printed circuits' own copper and fibre, laid out with them: each trace arrives
    // already carrying the current its circuit sends down it
    if (opts.pre) {
      for (const t0 of opts.pre.traces) {
        const t = measure({ p: t0.p, w: t0.w, net: 1, fib: t0.fib, gate: t0.gate });
        if (t0.ch.length) t.ch = t0.ch;
        traces.push(t);
      }
      vias.push(...opts.pre.vias);
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
      if (t.L >= (flow ? 30 : 48) && rnd() < pc) {
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

  /* ------------------------------------------------------------------ circuits */

  // Real circuits printed onto the board: working blocks of one NYNA design (power in, a clock,
  // the optical link, drivers, sensors), each named in silkscreen. Every part sits on one 10px
  // pitch, so the copper runs dead straight, and signal flows left to right. A block also says
  // how it behaves: what current runs where (a steady supply, clock ticks, bursts of data) and
  // which of its LEDs are lit when, so the board does what the real one would.
  const turn = (q, x, y) => (q === 1 ? [-y, x] : q === 2 ? [-x, -y] : q === 3 ? [y, -x] : [x, y]);
  const SIDES = { L: [[-1, 0], [0, 1]], B: [[0, 1], [1, 0]], R: [[1, 0], [0, -1]], T: [[0, -1], [-1, 0]] };
  // one row of n pins at pitch p along a side of a package, pad centres d from the middle; pins
  // count anticlockwise from the top of the left side, as on a real package
  function pins(side, n, p, d, len, wid) {
    const [[ux, uy], [tx, ty]] = SIDES[side], out = [];
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * p;
      out.push({ x: ux * d + tx * a, y: uy * d + ty * a, w: ux ? len : wid, h: ux ? wid : len, u: [ux, uy], shape: 'r' });
    }
    return out;
  }
  const pad = (x, y, w, h, shape = 'r') => ({ x, y, w, h, u: [0, 0], shape });
  const pair = (x, w, h) => [pad(-x, 0, w, h), pad(x, 0, w, h)];
  const ring = (r, x = 0, y = 0) => `M${x + r} ${y}A${r} ${r} 0 1 0 ${x - r} ${y}A${r} ${r} 0 1 0 ${x + r} ${y}Z`;
  const rect = (w, h) => `M${-w} ${-h}H${w}V${h}H${-w}Z`;
  const row = (ys, x, shape) => ys.map((y, i) => pad(x, y, shape ? 8 : 9, shape ? 8 : 5.5, shape ? (i ? 'c' : 's') : 'r'));
  const CHIP = pair(9, 7, 7);                                    // the two pads of every small part
  const PKG = {
    SO8: { ic: 1, legs: 1, body: [26, 42], pads: [...pins('L', 4, 10, 23, 12, 6), ...pins('R', 4, 10, 23, 12, 6)] },
    SO18: { ic: 1, legs: 1, body: [30, 96], pads: [...pins('L', 9, 10, 25, 12, 5.5), ...pins('R', 9, 10, 25, 12, 5.5)] },
    SOT5: { ic: 1, legs: 1, body: [18, 32], pads: [...pins('L', 3, 10, 17, 10, 5.5), ...pins('R', 2, 20, 17, 10, 5.5)] },
    SOT3: { ic: 1, legs: 1, pre: 'Q', body: [14, 30], pads: [...pins('L', 2, 20, 15, 9, 5.5), ...pins('R', 1, 20, 15, 9, 5.5)] },
    DFN8: { ic: 1, body: [28, 44], pads: [...pins('L', 4, 10, 15.5, 7, 5), ...pins('R', 4, 10, 15.5, 7, 5)] },
    QFN16: { ic: 1, body: [44, 44], pads: ['L', 'B', 'R', 'T'].flatMap(s => pins(s, 4, 10, 24, 8, 5)) },
    R: { pre: 'R', ext: [12.5, 5], pads: CHIP, silk: 'M-3.5 -5H3.5M-3.5 5H3.5' },
    C: { pre: 'C', ext: [13, 5.5], pads: CHIP, silk: 'M-11.5 -5.5H11.5A1.5 1.5 0 0 1 13 -4V4A1.5 1.5 0 0 1 11.5 5.5H-11.5A1.5 1.5 0 0 1 -13 4V-4A1.5 1.5 0 0 1 -11.5 -5.5Z' },
    D: { pre: 'D', ext: [12.5, 5], pads: CHIP, silk: 'M-2.5 -3.5L3 0L-2.5 3.5ZM3.5 -3.5V3.5' },
    F: { pre: 'F', ext: [12.5, 5], pads: CHIP, silk: rect(4, 5) },
    L: { pre: 'L', ext: [12.5, 5], pads: CHIP, silk: 'M-5 2A2.5 2.5 0 0 1 0 2A2.5 2.5 0 0 1 5 2' },
    Y: { pre: 'Y', ext: [16, 7], pads: pair(10, 7, 9), silk: 'M-9 -7H9A7 7 0 0 1 9 7H-9A7 7 0 0 1 -9 -7Z' },
    SW: { pre: 'SW', ext: [11, 13], pads: pair(15, 8, 9), silk: rect(11, 13) + ring(6) },
    PD: { pre: 'PD', ext: [20, 14], pads: pair(12, 9, 11), silk: rect(20, 14) + rect(7, 8) },
    // parts that give off light (or sound): a lens that is dull until it is on, and how far its glow reaches
    LED: { pre: 'D', ext: [12.5, 5], pads: CHIP, silk: 'M-4.5 -5H4.5M-4.5 5H4.5', lens: 'M-4.5 -3.5H4.5V3.5H-4.5Z', glow: 13 },
    LD: { pre: 'LD', ext: [20, 14], pads: pair(12, 9, 11), silk: rect(20, 14), lens: ring(5.5), glow: 16 },
    PX: { pre: 'D', ext: [11, 11], pads: [pad(-13, -6, 7, 6), pad(-13, 6, 7, 6), pad(13, 6, 7, 6), pad(13, -6, 7, 6)], silk: rect(11, 11), lens: ring(6), glow: 15 },
    LS: { pre: 'LS', ext: [19, 19], pads: [pad(0, -5, 8, 6), pad(0, 5, 8, 6)], silk: ring(19) + ring(12), glow: 27 },
    // an antenna printed in the copper itself: a meander, and the waves that leave it while it is sending
    ANT: { pre: 'ANT', ext: [34, 13], pads: [pad(-30, 0, 6, 6)], cu: 'M-27 0H-20V-10H-13V10H-6V-10H1V10H8V-10H15V0',
      wave: 'M21.9 -5.8A9 9 0 0 1 21.9 5.8M25.7 -9A14 14 0 0 1 25.7 9M29.6 -12.2A19 19 0 0 1 29.6 12.2', glow: 0 },
    USB: { pre: 'J', ext: [16, 26], pads: row([-15, -5, 5, 15], 14), silk: 'M-16 -26H6V26H-16ZM-11 -18H-3V18H-11Z' },
    J9: { pre: 'J', hole: 1.9, ext: [6, 46], silk: rect(6, 46), pads: row([-40, -30, -20, -10, 0, 10, 20, 30, 40], 0, 1) },
    J4: { pre: 'J', hole: 1.9, ext: [6, 21], silk: rect(6, 21), pads: row([-15, -5, 5, 15], 0, 1) },
    J2: { pre: 'J', hole: 1.9, ext: [6, 11], silk: rect(6, 11), pads: row([-5, 5], 0, 1) }
  };

  const polyLen = p => { let L = 0; for (let k = 1; k < p.length; k++) L += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); return L; };
  const DC = { sp: 26, every: 52 };                              // a supply: slow, steady, always there
  const DATA = { n: 5, dt: 0.14, T: 3.4, sp: 100 };              // one frame on the optical link
  const LIGHT_SP = 320;                                          // px/s down a fibre

  // Build a circuit around (0,0): its parts, the copper joining them, its labels, and what it does.
  function circuit(title, build) {
    const parts = [], traces = [], vias = [], vip = [], labels = [], leds = [], ports = {};
    const grow = (b, x0, y0, x1, y1) => { b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1); };
    const trace = (pts, w, fib) => { const t = { p: pts, w, fib, ch: [], gate: null }; traces.push(t); return t; };
    const m = {
      add(key, x, y, q = 0, mark = null, refAt = 'above') {
        const P = PKG[key], [ew, eh] = P.body || [P.ext[0] * 2, P.ext[1] * 2], [bw, bh] = q % 2 ? [eh, ew] : [ew, eh];
        const part = { P, q, cx: x, cy: y, mark, refAt, own: [x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2] };
        part.pads = P.pads.map(pd => {
          const [px, py] = turn(q, pd.x, pd.y), odd = q % 2, w = odd ? pd.h : pd.w, h = odd ? pd.w : pd.h;
          grow(part.own, x + px - w / 2, y + py - h / 2, x + px + w / 2, y + py + h / 2);
          return { x: x + px, y: y + py, shape: pd.shape };
        });
        parts.push(part);
        return parts.length - 1;
      },
      // a column of identical parts on the pitch, labelled once as a range
      stack(key, x, ys) {
        const ids = ys.map(y => m.add(key, x, y, 0, null, null));
        labels.push({ kind: 'group', ids, x, y: parts[ids[0]].own[1] - 5, anchor: 'middle' });
        return ids;
      },
      pad(i, k) { const pd = parts[i].pads[k]; return [pd.x, pd.y]; },
      wire(...pts) { return trace(pts, 1.2); },
      power(...pts) { return trace(pts, 2.4); },
      fibre(...pts) { return trace(pts, 1.2, 1); },                // light, not copper
      via(x, y) { vias.push([x, y]); },
      vip(i, ...ks) { for (const k of ks) vip.push(m.pad(i, k)); },   // a via in the pad: straight down to a plane
      net(text, x, y, anchor = 'middle', port = null) { labels.push({ kind: 'net', text, x, y, anchor, port }); },
      group(ids, x, y) { labels.push({ kind: 'group', ids, x, y, anchor: 'middle' }); },
      title(x, y) { labels.push({ kind: 'title', text: title, x, y, anchor: 'start' }); },
      port(name, x, y) { ports[name] = [x, y]; },
      // steady current: charges an even distance apart, moving all the time
      flow({ sp, every }, ...ws) {
        for (const t of ws) {
          const L = polyLen(t.p), n = Math.max(1, Math.round(L / every));
          for (let i = 0; i < n; i++) t.ch.push({ sp, per: L, ph: i * L / n, rev: false });
        }
      },
      // a train of n pulses dt seconds apart, sent every T seconds from `at`, down the wires in turn
      // as one path (the way through a part between two wires counts as distance too)
      send({ n = 1, dt = 0.14, T = 3, sp = 100, at = 0, rev = false }, ...ws) {
        let D = 0, last = null;
        for (const t of ws) {
          const a = rev ? t.p[t.p.length - 1] : t.p[0], b = rev ? t.p[0] : t.p[t.p.length - 1];
          if (last) D += Math.hypot(a[0] - last[0], a[1] - last[1]);
          for (let j = 0; j < n; j++) t.ch.push({ sp, per: sp * T, ph: -D - sp * (at + j * dt), rev });
          D += polyLen(t.p); last = b;
        }
        return {
          L: D,
          at: d => at + d / sp,                                    // when the first pulse is d px down the path
          hits: (d, on) => Array.from({ length: n }, (_, j) => [T, at + d / sp + j * dt, on])   // an LED there flickers with each pulse
        };
      },
      // the same, but sent when the page fires a named signal (see `fire`) instead of on a timer
      on(name, { sp = 100, at = 0 }, ...ws) {
        let D = 0, last = null;
        for (const t of ws) {
          if (last) D += Math.hypot(t.p[0][0] - last[0], t.p[0][1] - last[1]);
          t.ch.push({ ev: name, sp, off: D + sp * at, rev: false });
          D += polyLen(t.p); last = t.p[t.p.length - 1];
        }
        return { L: D, at: d => at + d / sp, hits: (d, dur) => [[name, at + d / sp, dur]] };
      },
      // an LED: `win` is when it is lit on its own clock, `ev` when it is lit after a fired signal
      led(i, win, ev) { const rec = { i, win, ev }; leds.push(rec); return rec; },
      gate(rec, ...ws) { for (const t of ws) t.gate = rec; }       // current that only runs while that LED is lit
    };
    build(m);
    parts.forEach((part, i) => {
      if (part.P.ic || !part.refAt) return;
      const [x0, y0, x1, y1] = part.own;
      const at = { above: [part.cx, y0 - 5, 'middle'], below: [part.cx, y1 + 10, 'middle'],
        left: [x0 - 4, part.cy + 3, 'end'], right: [x1 + 4, part.cy + 3, 'start'] }[part.refAt];
      labels.push({ kind: 'ref', ids: [i], x: at[0], y: at[1], anchor: at[2] });
    });
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const part of parts) grow(box, ...part.own);
    for (const t of traces) for (const [x, y] of t.p) grow(box, x - 3, y - 3, x + 3, y + 3);
    for (const [x, y] of vias) grow(box, x - 4.5, y - 4.5, x + 4.5, y + 4.5);
    for (const l of labels) {
      const n = l.kind === 'net' || l.kind === 'title' ? l.text.length : l.kind === 'ref' ? 3 : l.ids.length > 2 ? 7 : l.ids.length * 3.5;
      const w = n * (l.kind === 'net' ? 6.6 : l.kind === 'title' ? 7.6 : 7.4), a = l.anchor;
      const lx = a === 'start' ? l.x : a === 'end' ? l.x - w : l.x - w / 2;
      grow(box, lx, l.y - 8, lx + w, l.y + 2);
    }
    return { title, parts, traces, vias, vip, labels, leds, ports, box, w: box[2] - box[0], h: box[3] - box[1] };
  }

  // an I2C exchange: the address clocked out, then the reading clocked back
  const i2c = (m, sda, scl) => {
    const T = 3.1;
    m.send({ n: 8, dt: 0.085, T }, scl); m.send({ n: 3, dt: 0.17, T }, sda);
    m.send({ n: 8, dt: 0.085, T, at: 1.15 }, scl); m.send({ n: 4, dt: 0.13, T, at: 1.15, rev: true }, sda);
  };

  const KITS = {
    // USB-C in: both CC pins pulled down through 5K1 so a charger will supply 5V, a fuse, and a bulk capacitor
    USB: circuit('USB-C POWER', m => {
      const j = m.add('USB', -60, 0);
      const f = m.add('F', -16, -15, 0, null, null), r1 = m.add('R', -16, -5, 0, null, null), r2 = m.add('R', -16, 5, 0, null, null);
      const c = m.add('C', 30, 4, 1, null, 'right');
      m.group([f, r1, r2], -16, -25);
      const bus = m.wire(m.pad(j, 0), m.pad(f, 0), m.pad(f, 1), [30, -15], [48, -15]);
      m.wire([30, -15], m.pad(c, 0));
      m.wire(m.pad(j, 1), m.pad(r1, 0), m.pad(r1, 1), [6, -5], [6, 26]);
      m.wire(m.pad(j, 2), m.pad(r2, 0), m.pad(r2, 1), [6, 5]);
      m.wire(m.pad(j, 3), [-46, 26]); m.wire(m.pad(c, 1), [30, 26]);
      const gnd = m.power([40, 26], [-46, 26]);
      m.net('5V', 52, -12, 'start', 'out'); m.net('GND', 44, 29, 'start'); m.net('5K1', -16, 20);
      m.flow(DC, bus, gnd);
      m.port('out', 48, -15); m.title(-76, -44);
    }),
    // 5V down to 3V3: an AP2112K with its input and output capacitors, enable tied high, and a power LED
    REG: circuit('3V3 REGULATOR', m => {
      const j = m.add('J2', -92, -5);
      const c1 = m.add('C', -52, -1, 1, null, 'left'), u = m.add('SOT5', 0, 0, 0, 'AP2112K'), c2 = m.add('C', 44, -1, 1, null, 'right');
      const r = m.add('R', 84, -10), d = m.add('LED', 116, -10);
      const vin = m.wire(m.pad(j, 0), m.pad(c1, 0), m.pad(u, 0));
      m.wire(m.pad(u, 2), [-32, 10], [-32, -10]);
      const out = m.wire(m.pad(u, 4), m.pad(c2, 0), m.pad(r, 0), m.pad(r, 1), m.pad(d, 0), m.pad(d, 1), [140, -10], [140, 30]);
      m.wire(m.pad(j, 1), [-92, 30]); m.wire(m.pad(c1, 1), [-52, 30]); m.wire(m.pad(c2, 1), [44, 30]);
      const gnd = m.power([140, 30], [-92, 30]);
      m.net('5V', -102, -7, 'end', 'in'); m.net('3V3', 61, -15); m.net('PWR', 116, 7); m.net('GND', 144, 33, 'start');
      m.vip(u, 1);
      m.flow(DC, vin, out, gnd); m.led(d, 'on');
      m.port('in', -98, -10); m.title(-116, -36);
    }),
    // the microcontroller's clock: a crystal and its two load capacitors
    XTAL: circuit('8MHZ CRYSTAL', m => {
      const y = m.add('Y', 0, -10), c1 = m.add('C', -24, 8, 1, null, 'left'), c2 = m.add('C', 24, 8, 1, null, 'right');
      const osc = m.wire([-44, -10], [-24, -10], m.pad(y, 0), m.pad(y, 1), [24, -10], [44, -10]);
      m.wire([-24, -10], m.pad(c1, 0)); m.wire([24, -10], m.pad(c2, 0));
      m.wire(m.pad(c1, 1), [-24, 28]); m.wire(m.pad(c2, 1), [24, 28]);
      m.power([-34, 28], [34, 28]);
      m.net('XI', -48, -7, 'end'); m.net('XO', 48, -7, 'start'); m.net('GND', 38, 31, 'start');
      m.flow({ sp: 150, every: 30 }, osc);
      m.title(-62, -36);
    }),
    // reset: a button to ground, held high through 10K and debounced by a capacitor
    RST: circuit('RESET', m => {
      const sw = m.add('SW', -40, 0, 0, null, 'below'), r = m.add('R', -8, -19, 1, null, 'right'), c = m.add('C', 14, 15, 1, null, 'right');
      m.wire(m.pad(sw, 1), [-8, 0], [14, 0], [34, 0]);
      const up = m.wire([-8, -36], m.pad(r, 0), m.pad(r, 1), [-8, 0]);
      m.wire([14, 0], m.pad(c, 0));
      m.power([-30, -36], [14, -36]);
      m.net('3V3', -34, -33, 'end'); m.net('EN', 38, 3, 'start');
      m.vip(sw, 0); m.vip(c, 1);
      m.flow({ sp: 14, every: 60 }, up);
      m.title(-59, -46);
    }),
    // the link's transmitter: data switches a transistor, the transistor switches a laser into the fibre
    TX: circuit('LASER TX', m => {
      const rb = m.add('R', -44, 10, 0, null, 'below'), q = m.add('SOT3', -4, 0), rs = m.add('R', 20, -26), ld = m.add('LD', 52, 0, 0, null, 'below');
      const din = m.wire([-70, 10], m.pad(rb, 0), m.pad(rb, 1), m.pad(q, 1));
      const vcc = m.wire([-70, -26], m.pad(rs, 0), m.pad(rs, 1), [64, -26], m.pad(ld, 1));
      const sink = m.wire(m.pad(ld, 0), m.pad(q, 2));
      const out = m.fibre([72, 0], [100, 0]);
      m.vip(q, 0);
      m.net('TX', -74, 13, 'end'); m.net('5V', -74, -23, 'end');
      const a = m.send(DATA, din);                                           // each bit reaches the base,
      const b = m.send({ ...DATA, sp: 260, at: a.at(a.L) }, vcc, sink);      // pulls current through the laser,
      const lit = b.at(polyLen(vcc.p));
      m.led(ld, b.hits(polyLen(vcc.p), 0.085));
      m.send({ ...DATA, sp: LIGHT_SP, at: lit }, out);                       // and leaves as light
      m.port('out', 100, 0); m.title(-88, -38);
    }),
    // the link's receiver: photodiode, transimpedance amplifier with Rf and Cf, a comparator with
    // hysteresis, a series resistor out to the microcontroller and an LED on the recovered data
    RX: circuit('OPTICAL RX', m => {
      const pd = m.add('PD', -100, -5);
      const a = m.add('SO8', -34, 0, 0, 'OPA356'), b = m.add('SO8', 62, 0, 0, 'TLV3501');
      const cf = m.add('C', -34, -52, 0, null, null), rf = m.add('R', -34, -32, 0, null, null);
      const rh = m.add('R', 62, -32), rs = m.add('R', 120, 5);
      const rl = m.add('R', 118, 27, 0, null, 'below'), d = m.add('LED', 148, 27, 0, null, 'below');
      m.group([rf, cf], -34, -63);
      const fin = m.fibre([-138, -5], [-120, -5]);
      const i1 = m.wire(m.pad(pd, 1), m.pad(a, 1));                          // photocurrent into the inverting input
      m.wire(m.pad(pd, 0), [-112, 18]); m.via(-112, 18);                     // reverse bias
      const o1 = m.wire(m.pad(a, 5), [2, 5], m.pad(b, 2));                   // the amplifier's output into the comparator
      m.wire([2, 5], [2, -52], m.pad(cf, 1)); m.wire([2, -32], m.pad(rf, 1));   // and back over the top,
      m.wire(m.pad(cf, 0), [-70, -52], [-70, -5]); m.wire(m.pad(rf, 0), [-70, -32]);   // through Cf and Rf to the input
      const o2 = m.wire(m.pad(b, 5), [98, 5], m.pad(rs, 0), m.pad(rs, 1), [150, 5]);
      m.wire([98, 5], [98, -32], m.pad(rh, 1)); m.wire(m.pad(rh, 0), [26, -32], [26, 5]);   // hysteresis
      const ind = m.wire([98, 5], [98, 27], m.pad(rl, 0), m.pad(rl, 1), m.pad(d, 0), m.pad(d, 1), [168, 27]); m.via(168, 27);
      m.net('RX', 154, 8, 'start'); m.vip(a, 2, 3, 6); m.vip(b, 1, 3, 6);
      const f = m.send({ ...DATA, sp: LIGHT_SP }, fin);                      // light in,
      const s = m.send({ ...DATA, at: f.at(f.L) }, i1, o1, o2);              // and the same bits come out the far end
      const tap = s.at(187);                                                 // where the LED's branch leaves the output
      const t = m.send({ ...DATA, at: tap }, ind);
      m.led(d, t.hits(72, 0.085));
      m.port('in', -138, -5); m.title(-138, -64);
    }),
    // a 555 running free: RA and RB charge the timing capacitor, the output blinks an LED and clocks whatever follows
    T555: circuit('555 TIMER', m => {
      const u = m.add('SO8', 0, 0, 2, 'NE555');
      const ra = m.add('R', -56, 24, 1, null, 'left'), rb = m.add('R', -56, -12, 1, null, 'left'), c = m.add('C', -78, -29);
      const rl = m.add('R', 62, 22, 0, null, 'below'), d = m.add('LED', 94, 22, 0, null, 'below');
      m.power([-78, 40], [40, 40]);
      m.wire(m.pad(u, 7), [-23, 40]);
      const up = m.wire([-56, 40], m.pad(ra, 1), m.pad(ra, 0), [-56, 5]);
      const cap = m.wire([-56, 5], m.pad(rb, 1), m.pad(rb, 0), [-56, -29], m.pad(c, 1));
      const dis = m.wire([-56, 5], m.pad(u, 6));
      m.wire([-56, -29], [-40, -29], [-40, -5], m.pad(u, 5));
      const clk = m.wire(m.pad(u, 2), [40, -5], [112, -5]);
      const ind = m.wire([40, -5], [40, 22], m.pad(rl, 0), m.pad(rl, 1), m.pad(d, 0), m.pad(d, 1), [114, 22]); m.via(114, 22);
      m.vip(u, 0, 1, 3, 4); m.vip(c, 0);
      m.net('5V', -82, 43, 'end'); m.net('CLK', 116, -2, 'start');
      const T = 1.3;
      m.send({ T, sp: 130 }, up, cap);                                       // charging through RA and RB: output high,
      m.send({ T, sp: 130, at: T / 2, rev: true }, cap); m.send({ T, sp: 130, at: T / 2 + polyLen(cap.p) / 130 }, dis);   // discharging through RB: low
      m.send({ T, sp: 110 }, clk);
      const b = m.send({ T, sp: 110, at: 17 / 110 }, ind);
      m.led(d, [[T, b.at(81), T / 2]]);
      m.title(-96, -52);
    }),
    // eight outputs through a ULN2803 Darlington driver, 330R resistors and LEDs on a 5V rail, driven one after another
    LED: circuit('LED DRIVER', m => {
      const j = m.add('J9', -92, 0, 0, null, 'below'), u = m.add('SO18', 0, 0, 0, 'ULN2803');
      const ys = [-40, -30, -20, -10, 0, 10, 20, 30];
      const rs = m.stack('R', 62, ys), ds = m.stack('LED', 120, ys);
      const step = 0.42, T = step * 8;
      ys.forEach((y, i) => {
        const w = m.wire(m.pad(j, i), m.pad(u, i), m.pad(u, 17 - i), m.pad(rs[i], 0), m.pad(rs[i], 1), m.pad(ds[i], 0), m.pad(ds[i], 1), [140, y]);
        const s = m.send({ T, sp: 240, at: i * step }, w);
        m.led(ds[i], [[T, s.at(212), step]]);                                // lit from when its pulse arrives until the next channel's does
      });
      m.wire(m.pad(j, 8), m.pad(u, 8));
      m.wire(m.pad(u, 9), [34, 40], [46, 52], [140, 52]);                    // the clamp diodes' common to the supply
      m.power([140, 52], [140, -40]);
      m.net('5V', 146, -37, 'start'); m.net('330R', 62, 44);
      m.title(-98, -51);
    }),
    // three addressable LEDs on one data line: each takes its colour from the frame and passes the rest on
    RGB: circuit('STATUS LEDS', m => {
      const px = [-40, 0, 40].map(x => m.add('PX', x, 0, 0, null, null));
      m.group(px, 0, 21);
      const run = [m.wire([-70, 6], m.pad(px[0], 1)), m.wire(m.pad(px[0], 2), m.pad(px[1], 1)), m.wire(m.pad(px[1], 2), m.pad(px[2], 1)), m.wire(m.pad(px[2], 2), [68, 6])];
      m.via(68, 6);
      const rail = m.wire([-66, -26], [27, -26], m.pad(px[2], 0));
      m.wire([-53, -26], m.pad(px[0], 0)); m.wire([-13, -26], m.pad(px[1], 0));
      px.forEach(i => m.vip(i, 3));
      m.net('DIN', -74, 9, 'end'); m.net('5V', -70, -23, 'end');
      const T = 2.7, s = m.send({ n: 3, dt: 0.09, T, sp: 90 }, ...run);
      px.forEach((i, k) => m.led(i, [[T, s.at(17 + 40 * k), 1.35]]));
      m.flow(DC, rail);
      m.title(-94, -40);
    }),
    // a light-activated switch: light on the photodiode turns the transistor on, and the transistor turns the LED on
    LIGHT: circuit('LIGHT SWITCH', m => {
      const pd = m.add('PD', -50, -10), q = m.add('SOT3', 8, -20), r1 = m.add('R', -20, 6, 1, null, 'right');
      const d = m.add('LED', 54, -20), r2 = m.add('R', 84, -20);
      const sense = m.wire([-86, -10], m.pad(pd, 0), m.pad(pd, 1), m.pad(q, 1));
      m.wire([-20, -10], m.pad(r1, 0));
      const load = m.wire([106, -20], m.pad(r2, 1), m.pad(r2, 0), m.pad(d, 1), m.pad(d, 0), m.pad(q, 2));
      m.vip(q, 0); m.vip(r1, 1);
      m.net('3V3', -90, -7, 'end'); m.net('3V3', 110, -17, 'start');
      m.flow({ sp: 40, every: 40 }, sense, load);
      m.gate(m.led(d, 'light'), sense, load);
      m.title(-110, -46);
    }),
    // a temperature and humidity sensor on the I2C bus, both lines pulled up to 3V3 through 4K7
    I2C: circuit('I2C SENSOR', m => {
      const sn = m.add('DFN8', 30, 0, 0, 'SHT31');
      const r1 = m.add('R', -20, -30, 1, null, 'left'), r2 = m.add('R', -20, 30, 1, null, 'left'), c = m.add('C', 80, 28, 1, null, 'right');
      const sda = m.wire([-60, -15], m.pad(sn, 0)), scl = m.wire([-60, 15], m.pad(sn, 3));
      m.wire(m.pad(r1, 1), [-20, -15]); m.wire(m.pad(r1, 0), [-20, -46]);
      m.wire(m.pad(r2, 0), [-20, 15]); m.wire(m.pad(r2, 1), [-20, 46]);
      const vdd = m.wire([60, 46], [60, 15], m.pad(sn, 4));
      m.wire(m.pad(c, 1), [80, 46]); m.wire(m.pad(c, 0), [80, 8]); m.via(80, 8);
      m.power([-60, -46], [96, -46]); m.power([-60, 46], [96, 46]);
      m.net('SDA', -64, -12, 'end'); m.net('SCL', -64, 18, 'end');
      m.net('3V3', 100, -43, 'start'); m.net('3V3', 100, 49, 'start');
      m.vip(sn, 1, 7);
      i2c(m, sda, scl); m.flow(DC, vdd);
      m.title(-84, -56);
    }),
    // memory on the same bus: a 24LC64 with its address pins grounded and a decoupling capacitor
    ROM: circuit('I2C EEPROM', m => {
      const u = m.add('SO8', 0, 0, 2, '24LC64'), c = m.add('C', 22, 34, 0, null, 'below');
      const sda = m.wire([-60, -15], m.pad(u, 4)), scl = m.wire([-60, -5], m.pad(u, 5));
      const vcc = m.wire([-60, 34], [-36, 34], [-36, 15], m.pad(u, 7));
      m.wire([-36, 34], m.pad(c, 0)); m.wire(m.pad(c, 1), [44, 34]); m.via(44, 34);
      m.net('SDA', -64, -12, 'end'); m.net('SCL', -64, -2, 'end'); m.net('3V3', -64, 37, 'end');
      m.vip(u, 0, 1, 2, 3, 6);
      i2c(m, sda, scl); m.flow(DC, vcc);
      m.title(-84, -30);
    }),
    // digital audio in, a speaker out: a MAX98357 class D amplifier with its supply decoupled
    AMP: circuit('I2S AUDIO AMP', m => {
      const u = m.add('QFN16', 0, 0, 0, 'MAX98357'), c = m.add('C', 30, -40), ls = m.add('LS', 84, 0);
      const bck = m.wire([-70, -15], m.pad(u, 0)), lrc = m.wire([-70, -5], m.pad(u, 1)), din = m.wire([-70, 5], m.pad(u, 2));
      const op = m.wire(m.pad(u, 10), m.pad(ls, 0)), on = m.wire(m.pad(u, 9), m.pad(ls, 1));
      const vdd = m.wire([-20, -40], [5, -40], m.pad(u, 13));
      m.wire([5, -40], m.pad(c, 0)); m.wire(m.pad(c, 1), [52, -40]); m.via(52, -40);
      m.vip(u, 3, 5, 6);
      m.net('BCLK', -74, -12, 'end'); m.net('LRC', -74, -2, 'end'); m.net('DIN', -74, 8, 'end'); m.net('5V', -24, -37, 'end');
      const T = 1.5;
      m.flow({ sp: 150, every: 24 }, bck); m.send({ n: 2, dt: T / 2, T, sp: 120 }, lrc); m.send({ n: 4, dt: 0.1, T, sp: 120 }, din);
      const a = m.send({ n: 3, dt: 0.17, T, sp: 110, at: 0.5 }, op); m.send({ n: 3, dt: 0.17, T, sp: 110, at: 0.585 }, on);
      m.led(ls, a.hits(a.L, 0.1)); m.flow(DC, vdd);
      m.title(-100, -58);
    }),
    // a motor on a logic pin: PWM into a MOSFET's gate, the motor in its drain, a diode to catch the kick-back
    PWM: circuit('MOTOR DRIVER', m => {
      const rg = m.add('R', -46, 10), q = m.add('SOT3', -4, 0), rp = m.add('R', -28, 26, 1, null, 'right');
      const d = m.add('D', 36, -14, 1, null, 'left'), j = m.add('J2', 62, -5, 0, null, 'below');
      const pwm = m.wire([-70, 10], m.pad(rg, 0), m.pad(rg, 1), m.pad(q, 1));
      m.wire([-28, 10], m.pad(rp, 0)); m.vip(rp, 1); m.vip(q, 0);
      const vm = m.wire([-70, -28], [62, -28], m.pad(j, 0)), drn = m.wire(m.pad(j, 1), m.pad(q, 2));
      m.wire([36, -28], m.pad(d, 0)); m.wire(m.pad(d, 1), [36, 0]);
      m.net('PWM', -74, 13, 'end'); m.net('5V', -74, -25, 'end'); m.net('MOTOR', 62, 27);
      m.flow({ sp: 120, every: 26 }, pwm); m.flow({ sp: 60, every: 44 }, vm, drn);
      m.title(-94, -42);
    }),
    // a serial port for debugging: 3V3, TXD, RXD and ground on a header, a resistor in series with each data line
    UART: circuit('DEBUG UART', m => {
      const j = m.add('J4', 40, 0), r1 = m.add('R', 0, -5, 0, null, null), r2 = m.add('R', 0, 5, 0, null, null);
      m.group([r1, r2], 0, -15);
      const tx = m.wire([-40, -5], m.pad(r1, 0), m.pad(r1, 1), m.pad(j, 1)), rx = m.wire(m.pad(j, 2), m.pad(r2, 1), m.pad(r2, 0), [-40, 5]);
      m.net('TXD', -44, -2, 'end'); m.net('RXD', -44, 8, 'end');
      m.send({ n: 6, dt: 0.1, T: 4.4 }, tx); m.send({ n: 4, dt: 0.1, T: 4.4, at: 2.1 }, rx);
      m.title(-64, -40);
    }),
    // a single-cell charger: a TP4056 with its charge current set by one resistor, one LED while charging, one when full
    CHG: circuit('LI-ION CHARGER', m => {
      const u = m.add('SO8', 0, 0, 0, 'TP4056'), rp = m.add('R', -50, -5);
      const d1 = m.add('LED', 50, -5, 0, null, null), d2 = m.add('LED', 50, 5, 0, null, null);
      const rl = m.add('R', 88, -5), c = m.add('C', 46, 29, 1, null, 'right');
      m.group([d1, d2], 50, -15);
      const vin = m.wire([-70, 15], m.pad(u, 3));
      m.wire(m.pad(u, 1), m.pad(rp, 1)); m.vip(rp, 0); m.vip(u, 0, 2, 7);
      const bat = m.wire(m.pad(u, 4), [46, 15], [70, 15]);
      m.wire([46, 15], m.pad(c, 0)); m.vip(c, 1);
      const l1 = m.wire([110, -5], m.pad(rl, 1), m.pad(rl, 0), [72, -5], m.pad(d1, 1), m.pad(d1, 0), m.pad(u, 6));
      const l2 = m.wire([72, -5], [72, 5], m.pad(d2, 1), m.pad(d2, 0), m.pad(u, 5));
      m.net('5V', -74, 18, 'end'); m.net('5V', 114, -2, 'start'); m.net('BAT', 74, 18, 'start', 'out');
      const T = 9;
      m.flow(DC, vin, bat, l1, l2);
      m.gate(m.led(d1, [[T, 0, 6.2]]), vin, bat, l1);                        // charging,
      m.gate(m.led(d2, [[T, 6.2, 2.8]]), l2);                                // then full
      m.port('out', 70, 15); m.title(-88, -32);
    }),
    // the enquiry form's transmitter: whatever is typed is keyed onto a 433MHz carrier (a MAX1472
    // on a 13.56MHz crystal), matched through L and C and sent from an antenna printed on the board
    RADIO: circuit('RADIO TX', m => {
      const u = m.add('SO8', 0, 0, 2, 'MAX1472');
      const r1 = m.add('R', -50, -5, 0, null, 'below'), r2 = m.add('R', -78, -30), d = m.add('LED', -48, -30);
      const y = m.add('Y', 0, 36, 0, null, 'below');
      const l = m.add('L', 52, -15), c = m.add('C', 76, 3, 1, null, 'left'), ant = m.add('ANT', 124, -15);
      const din = m.wire([-110, -5], m.pad(r1, 0), m.pad(r1, 1), m.pad(u, 5));
      const ind = m.wire([-96, -5], [-96, -30], m.pad(r2, 0), m.pad(r2, 1), m.pad(d, 0), m.pad(d, 1), [-26, -30]); m.via(-26, -30);
      m.wire(m.pad(u, 7), [-23, 36], m.pad(y, 0)); m.wire(m.pad(u, 0), [23, 36], m.pad(y, 1));
      const rf = m.wire(m.pad(u, 3), m.pad(l, 0), m.pad(l, 1), [76, -15], m.pad(ant, 0));
      m.wire([76, -15], m.pad(c, 0)); m.vip(c, 1); m.vip(u, 1, 2, 4, 6);
      m.net('DATA', -114, -2, 'end'); m.net('TX', -48, -17); m.net('433MHZ', 124, 9);
      const T = 5.6, P = { n: 2, dt: 0.2, T, sp: 170 };
      const a = m.send(P, din), b = m.send({ ...P, at: a.at(a.L + 46) }, rf), i = m.send({ ...P, at: a.at(14) }, ind);   // a beacon every few seconds,
      const e = m.on('tx', { sp: 210 }, din), f = m.on('tx', { sp: 210, at: e.at(e.L + 46) }, rf), g = m.on('tx', { sp: 210, at: e.at(14) }, ind);   // and each thing typed
      m.led(d, i.hits(73, 0.11), g.hits(73, 0.11));
      m.led(ant, b.hits(b.L, 0.3), f.hits(f.L, 0.3));
      m.title(-140, -50);
    }),
    // the battery's voltage halved for the ADC, with a capacitor to hold it steady while it is sampled
    DIV: circuit('V-DIVIDER', m => {
      const r1 = m.add('R', -20, -10), r2 = m.add('R', 4, 6, 1, null, 'left'), c = m.add('C', 24, 6, 1, null, 'right');
      const top = m.wire([-48, -10], m.pad(r1, 0), m.pad(r1, 1), [4, -10], [24, -10], [38, -10]);
      const dn = m.wire([4, -10], m.pad(r2, 0), m.pad(r2, 1), [4, 26]);
      m.wire([24, -10], m.pad(c, 0)); m.wire(m.pad(c, 1), [24, 26]);
      m.power([-6, 26], [34, 26]);
      m.net('VBAT', -52, -7, 'end', 'in'); m.net('ADC', 42, -7, 'start'); m.net('GND', 38, 29, 'start');
      m.flow(DC, top, dn);
      m.port('in', -48, -10); m.title(-78, -34);
    })
  };
  KITS.TX.emit = (() => { const t = KITS.TX.traces.find(x => x.fib), c = t.ch[0]; return -c.ph / c.sp + polyLen(t.p) / c.sp; })();

  // one part, drawn around (0,0) in silkscreen: its pads, its outline or moulded body, and the lens of anything that lights
  function partArt(part) {
    const P = part.P, f = n => Math.round(n * 10) / 10;
    const padRect = pd => `<rect class="k-pad" x="${f(pd.x - pd.w / 2)}" y="${f(pd.y - pd.h / 2)}" width="${pd.w}" height="${pd.h}" rx="${Math.min(pd.w, pd.h) > 7 ? 1 : 0.8}"/>`;
    let body = '';
    if (P.ic) {
      const [bw, bh] = P.body, hw = bw / 2, hh = bh / 2;
      // a populated package: its leads, its pads, a soft shadow and the moulded body over them
      if (P.legs) for (const pd of P.pads) {
        const ux = pd.u[0], xa = ux * hw, xb = pd.x - ux * pd.w / 2;
        body += `<rect class="k-lead" x="${f(Math.min(xa, xb))}" y="${f(pd.y - pd.h * 0.3)}" width="${f(Math.abs(xb - xa))}" height="${f(pd.h * 0.6)}"/>`;
      }
      for (const pd of P.pads) body += padRect(pd);
      body += `<rect class="k-shadow" x="${-hw + 1}" y="${-hh + 2}" width="${bw}" height="${bh}" rx="2.5"/>`;
      body += `<rect class="k-body" x="${-hw}" y="${-hh}" width="${bw}" height="${bh}" rx="2"/>`;
      // pin 1: marked on the body, or beside it on a package too small to carry the mark and the label
      if (Math.min(bw, bh) < 24) body += `<circle class="k-dot" cx="${-hw - 4}" cy="${-hh - 4}" r="1.5"/>`;
      else body += `<circle class="k-dot" cx="${-hw + 5}" cy="${-hh + 5}" r="1.7"/>`;
    } else {
      for (const pd of P.pads) {
        if (pd.shape === 'r') { body += padRect(pd); continue; }
        // a through-hole pad: a ring (square for pin 1) around its drill
        const o = pd.w / 2, hr = P.hole, x = pd.x, y = pd.y;
        const outer = pd.shape === 's' ? `M${x - o} ${y - o}h${pd.w}v${pd.w}h${-pd.w}Z` : ring(o, x, y);
        body += `<path class="k-pad" fill-rule="evenodd" d="${outer}${ring(hr, x, y)}"/>`;
        if (!surfaceOn) body += `<circle class="k-drill" cx="${x}" cy="${y}" r="${hr}"/>`;
      }
      if (P.silk) body += `<path class="k-silk" d="${P.silk}"/>`;
      if (P.cu) body += `<path class="k-cu" d="${P.cu}"/>`;
      if (P.lens) body += `<path class="k-lens" d="${P.lens}"/>`;
    }
    return `<g transform="translate(${f(part.cx)} ${f(part.cy)})${part.q ? ` rotate(${part.q * 90})` : ''}">${body}</g>`;
  }

  // a whole circuit in its own coordinates: parts, vias in pads, the fibre it sends or takes, and every label
  function kitArt(M, refs, hide) {
    const f = n => Math.round(n * 10) / 10;
    let art = '', text = '';
    for (const t of M.traces) if (t.fib) art += fibreArt(t.p, 2.4);
    M.parts.forEach((part, i) => {
      art += partArt(part);
      if (!part.P.ic) return;
      // the reference and the part number, laser-marked along the body's long side
      const [bw, bh] = part.P.body, dw = part.q % 2 ? bh : bw, dh = part.q % 2 ? bw : bh, small = Math.min(dw, dh) < 24;
      const lines = small || !part.mark ? `<text class="k-icref" y="0">${refs[i]}</text>`
        : `<text class="k-icref" y="-4">${refs[i]}</text><text class="k-mark" y="5">${part.mark}</text>`;
      text += `<g transform="translate(${f(part.cx)} ${f(part.cy)})${dh > dw * 1.15 ? ' rotate(-90)' : ''}">${lines}</g>`;
    });
    for (const [x, y] of M.vip) art += `<circle class="k-vip" cx="${f(x)}" cy="${f(y)}" r="1.6"/>`;
    for (const l of M.labels) {
      if (l.port && hide && hide.has(l.port)) continue;
      let s = l.text;
      if (l.ids) {
        const rs = l.ids.map(i => refs[i]), pre = rs[0].replace(/\d+$/, ''), nums = rs.map(r => +r.slice(pre.length));
        s = rs.length > 2 && rs.every(r => r.startsWith(pre)) && nums.every((n, i) => !i || n === nums[i - 1] + 1) ? `${rs[0]}-${rs[rs.length - 1]}` : rs.join(' ');
      }
      text += `<text class="k-${l.kind === 'net' ? 'net' : l.kind === 'title' ? 'title' : 'ref'}" x="${f(l.x)}" y="${f(l.y)}" text-anchor="${l.anchor}">${s}</text>`;
    }
    return art + text;
  }
  // a fibre: two fine lines with the light running between them
  function fibreArt(pts, d) {
    const line = p => 'M' + p.map(q => (Math.round(q[0] * 10) / 10) + ' ' + (Math.round(q[1] * 10) / 10)).join('L');
    return `<path class="k-fibre" d="${line(offsetPath(pts, d))}${line(offsetPath(pts, -d))}"/>`;
  }

  // Where each circuit goes. A row of them has a slot in the page (a .kit element, before a
  // section): an ordinary layout box whose size the stylesheet sets at every width. The row is laid
  // into it the way words are laid into a paragraph: every block at one scale, wrapped onto a second
  // line where the slot is tall enough, spread edge to edge across the text column, and trimmed,
  // least important first, to what fits. In the lists the number after a name is that importance
  // (1 stays longest); the order is the order across the row.
  const ROWS = {
    power: ['XTAL:3', 'USB:2', 'REG:1', 'RST:4'],
    link: ['TX:1', 'RX:1'],
    drive: ['T555:2', 'LED:1', 'RGB:3'],
    sense: ['LIGHT:2', 'I2C:1', 'ROM:3'],
    output: ['AMP:1', 'PWM:2', 'UART:3'],
    battery: ['CHG:1', 'DIV:2'],
    comms: ['RADIO:1']
  };
  // neighbours that really are joined: one's output is the next one's input, by a trace or by fibre
  const LINKS = { 'USB>REG': 'trace', 'TX>RX': 'fibre', 'CHG>DIV': 'trace' };

  function placeKits(base, g) {
    const { W, C, R, rnd } = g;
    const out = { kits: [], traces: [], vias: [], drills: [], leds: [], fibres: [], notes: [] };
    const br = board.getBoundingClientRect();
    const slots = $$('.kit').map(el => ({ row: ROWS[el.dataset.kit], r: el.getBoundingClientRect() })).filter(s => s.row && s.r.width > 200 && s.r.height > 80);
    if (!slots.length) return out;
    const TALL = Math.max(...Object.values(KITS).map(M => M.h)), wide = row => Math.max(...row.map(x => KITS[x.split(':')[0]].w)) + 16;
    // one scale for the whole page: the tallest block fits the shortest slot, and each row's widest block its own slot
    // (never enlarged on a phone, where the slots are sized for two lines of blocks at their own size)
    let k = W < 700 ? 1 : 1.5;
    for (const s of slots) k = Math.min(k, (s.r.height - 12) / TALL, s.r.width / wide(s.row));
    k = Math.max(0.7, Math.floor(k * 100) / 100);
    const GAP = (W < 700 ? 16 : 26) * k, LG = 18 * k, IN = 16 * k, MAR = 14, count = {};
    const at = (o, q) => [o.ox + q[0] * k, o.oy + q[1] * k];
    const mark = (x0, y0, x1, y1) => {
      const i0 = Math.max(0, Math.floor(x0 / P)), i1 = Math.min(C, Math.floor(x1 / P) + 1);
      if (i1 > i0) for (let j = Math.max(0, Math.floor(y0 / P)); j <= Math.min(R - 1, Math.floor(y1 / P)); j++) base.fill(1, j * C + i0, j * C + i1);
    };

    for (const s of slots) {
      const X0 = s.r.left - br.left, Y0 = s.r.top - br.top, Hs = s.r.height;
      // whatever already stands in the slot (a honeycomb column reaching up into it) narrows the row
      let Ws = s.r.width;
      for (let j = Math.max(0, Math.ceil((Y0 + 10) / P)); j < Math.min(R, Math.floor((Y0 + Hs - 10) / P)); j++) {
        for (let i = Math.max(0, Math.floor((X0 + 6) / P)); i < C && i * P < X0 + Ws; i++) if (base[j * C + i]) { Ws = Math.max(0, i * P - X0); break; }
      }
      if (Ws < 150) continue;

      // wrap the row into lines, and drop the least important block until the lines fit the slot
      let items = s.row.map(spec => { const [id, pr] = spec.split(':'); return { id, M: KITS[id], pr: +pr }; });
      let lines = null, total = 0;
      while (items.length) {
        lines = [];
        let line = null;
        items.forEach((it, n) => {
          const w = it.M.w * k;
          if (!line || line.w + GAP + w > Ws + 0.5) {
            // a fibre coming round from the line above needs room at the left to get in
            const inset = line && LINKS[items[n - 1].id + '>' + it.id] === 'fibre' ? IN : 0;
            lines.push(line = { items: [], inset, w: inset - GAP, h: 0 });
          }
          line.items.push(it); line.w += GAP + w; line.h = Math.max(line.h, it.M.h * k);
        });
        total = lines.reduce((a, l) => a + l.h, 0) + (lines.length - 1) * LG;
        if (total <= Hs - 12 && lines.every(l => l.w <= Ws + 0.5)) break;
        const worst = items.reduce((a, b) => (b.pr >= a.pr ? b : a));
        items = items.filter(it => it !== worst); lines = null;
      }
      if (!lines) continue;

      let y = Y0 + (Hs - total) / 2, prev = null, prevLine = null, prevBottom = 0;
      for (const line of lines) {
        const n = line.items.length, gap = n > 1 ? GAP + (Ws - line.w) / (n - 1) : 0;
        // the blocks hang from the top of their line, so their names sit level; one joined to its
        // neighbour drops a little, where it has the room, so the trace or fibre between them is straight
        line.items.forEach((it, i) => {
          it.drop = 0;
          const was = line.items[i - 1];
          if (!was || !LINKS[was.id + '>' + it.id]) return;
          const d = (was.drop + (was.M.ports.out[1] - was.M.box[1]) * k) - (it.M.ports.in[1] - it.M.box[1]) * k;
          if (d > 0 && d <= line.h - it.M.h * k + 0.5) it.drop = d;
          else if (d < 0 && was.drop - d <= line.h - was.M.h * k + 0.5) was.drop -= d;
        });
        let x = X0 + line.inset;
        for (const it of line.items) {
          const M = it.M;
          const o = { M, id: it.id, k, ox: Math.round(x - M.box[0] * k), oy: Math.round(y + it.drop - M.box[1] * k), tOff: rnd() * 6, hide: new Set() };
          x += M.w * k + gap;
          // joined to the block before it?
          const kind = prev && LINKS[prev.id + '>' + it.id];
          if (kind && (prevLine === line || kind === 'fibre')) {
            const A = at(prev, prev.M.ports.out), B = at(o, M.ports.in);
            let path;
            if (prevLine === line) {
              const dy = B[1] - A[1], mx = (A[0] + B[0]) / 2, h = Math.min(Math.abs(dy) / 2, (B[0] - A[0]) / 2 - 2);
              path = Math.abs(dy) < 0.5 ? [A, B] : [A, [mx - h, A[1]], [mx + h, B[1]], B];
            } else {
              const c = 6 * k, xr = A[0] + 10 * k, xl = B[0] - 10 * k, ym = prevBottom + LG / 2;
              path = [A, [xr - c, A[1]], [xr, A[1] + c], [xr, ym - c], [xr - c, ym], [xl + c, ym], [xl, ym + c], [xl, B[1] - c], [xl + c, B[1]], B];
            }
            const L = polyLen(path), t = { p: path, w: 1.2, fib: kind === 'fibre' ? 1 : 0, gate: null, ch: [] };
            if (t.fib) {
              // the light leaves when the transmitter fires, and the receiver's clock starts when it arrives
              const sp = LIGHT_SP * k, t0 = prev.tOff + prev.M.emit;
              for (let j = 0; j < DATA.n; j++) t.ch.push({ sp, per: sp * DATA.T, ph: -sp * (t0 + j * DATA.dt), rev: false });
              o.tOff = t0 + L / sp;
              out.fibres.push({ p: path, k });
            } else {
              const m = Math.max(1, Math.round(L / (DC.every * k)));
              for (let i = 0; i < m; i++) t.ch.push({ sp: DC.sp * k, per: L, ph: i * L / m, rev: false });
            }
            out.traces.push(t);
            // a long join is named along its length: the fibre, or the net the trace carries
            if (prevLine === line && B[0] - A[0] > 150) {
              const lab = prev.M.labels.find(l => l.port === 'out');
              out.notes.push({ text: t.fib ? 'TOSLINK' : lab ? lab.text : '', x: A[0] + (B[0] - A[0]) / 4, y: A[1] - 8 * k, k });
            }
            for (let q = 1; q < path.length; q++) {
              mark(Math.min(path[q - 1][0], path[q][0]) - 8, Math.min(path[q - 1][1], path[q][1]) - 8, Math.max(path[q - 1][0], path[q][0]) + 8, Math.max(path[q - 1][1], path[q][1]) + 8);
            }
            prev.hide.add('out'); o.hide.add('in');
          }
          o.refs = M.parts.map(part => { const pre = part.P.pre || (part.P.ic ? 'U' : 'X'), num = count[pre] = (count[pre] || (pre === 'U' ? 4 : 0)) + 1; return pre + num; });
          out.kits.push(o);
          for (const part of M.parts) if (part.P.hole) for (const pd of part.pads) out.drills.push([...at(o, [pd.x, pd.y]), part.P.hole * k]);
          const leds = M.leds.map(rec => {
            const part = M.parts[rec.i], [lx, ly] = at(o, [part.cx, part.cy]);
            const d = { x: lx, y: ly, k, q: part.q, P: part.P, win: rec.win, ev: rec.ev, o, on: false, el: null };
            if (rec.win === 'light') { const eye = M.parts.find(q => q.P === PKG.PD); [d.sx, d.sy] = at(o, [eye.cx, eye.cy]); }
            out.leds.push(d);
            return d;
          });
          for (const t of M.traces) {
            out.traces.push({ p: t.p.map(q => at(o, q)), w: t.w, fib: t.fib, gate: t.gate ? leds[M.leds.indexOf(t.gate)] : null,
              ch: t.ch.map(c => (c.ev ? { ev: c.ev, sp: c.sp * k, off: c.off * k, rev: c.rev }
                : { sp: c.sp * k, per: c.per * k, ph: (c.ph - c.sp * o.tOff) * k, rev: c.rev })) });
          }
          for (const v of M.vias) out.vias.push(at(o, v));
          // nothing else gets routed through a circuit
          const [bx0, by0] = at(o, [M.box[0], M.box[1]]), [bx1, by1] = at(o, [M.box[2], M.box[3]]);
          mark(bx0 - MAR, by0 - MAR, bx1 + MAR, by1 + MAR);
          prev = o; prevLine = line;
        }
        prevBottom = y + line.h;
        y += line.h + LG;
      }
    }
    // every phase inside its own period, so each charge is where it belongs from the first frame
    for (const t of out.traces) for (const c of t.ch) if (!c.ev) c.ph = ((c.ph % c.per) + c.per) % c.per;
    return out;
  }

  function generate() {
    const br = board.getBoundingClientRect();
    const W = Math.round(br.width), H = Math.round(br.height);
    const C = Math.ceil(W / P), R = Math.ceil(H / P);
    const base = new Uint8Array(C * R);
    const rnd = mulberry32(0x4E594E41 ^ Math.imul(W, 73856093) ^ Math.imul(H, 19349663));
    const EDGE = 3;                                    // cells reserved for the ground ring
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
      if (r.width && r.height) blockRect(r, mode === '0' ? 0 : el.classList.contains('perf') ? 26 : 14);
    });
    // the vertical section marker owns a clear channel down the left margin
    if (railv && getComputedStyle(railv).display !== 'none') {
      const rr = railv.getBoundingClientRect();
      block(rr.left - br.left, 0, rr.width, H, 12);
    }

    const g = { W, H, C, R, rnd, br, EDGE };
    const kit = placeKits(base, g);
    for (let j = 0; j < R; j++) {
      if (j < EDGE || j >= R - EDGE) { base.fill(1, j * C, j * C + C); continue; }
      base.fill(1, j * C, j * C + EDGE); base.fill(1, j * C + C - EDGE, j * C + C);
    }
    const top = route(base.slice(), g, { fanout: true, vias: true, busDiv: 46000, trDiv: 5400, chargeP: flow ? 0.85 : 0.6, pre: kit });
    const inner = route(base.slice(), g, { fanout: false, vias: false, busDiv: 60000, trDiv: 8000, chargeP: 0.36 });

    // stitching vias along the ground ring, then bucket every via on the top layer
    for (let x = 40; x < W - 40; x += 56) top.vias.push([x, 9], [x, H - 9]);
    for (let y = 40; y < H - 40; y += 56) top.vias.push([9, y], [W - 9, y]);
    top.vias.forEach((v, idx) => {
      const bi = Math.floor(v[0] / top.B), bj = Math.floor(v[1] / top.B);
      if (bi >= 0 && bj >= 0 && bi < top.bc && bj < top.bn) top.vb[bj * top.bc + bi].push(idx);
    });

    const rr = parseFloat(getComputedStyle(board).borderTopLeftRadius) || 20;
    net = { W, H, top, inner, kits: kit.kits, leds: kit.leds, fibres: kit.fibres, notes: kit.notes, drills: kit.drills, ring: { x: 9, y: 9, w: W - 18, h: H - 18, r: Math.max(4, rr - 9) } };
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
      (bands[k] || (bands[k] = { thin: '', wide: '', via: '', 'net-thin': '', 'net-wide': '' }))[kind] += d;
    };
    for (const t of T.traces) {
      if (t.fib) continue;                               // fibre is drawn with the silkscreen, not the copper
      let d = `M${f(t.p[0][0])} ${f(t.p[0][1])}`;
      for (let i = 1; i < t.p.length; i++) d += `L${f(t.p[i][0])} ${f(t.p[i][1])}`;
      put(t.p[0][1], (t.net ? 'net-' : '') + (t.w > 2 ? 'wide' : 'thin'), d);
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
      for (const kind of ['thin', 'wide', 'via', 'net-thin', 'net-wide']) {
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
    // silkscreen is ink on top of the mask: it sits over the glow, not under it
    if (silkSvg) tilesEl.appendChild(silkSvg);
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

  // every trace with a piece inside a rectangle, each listed once
  function gather(L, x0, y0, w, h, out) {
    const stamp = ++L.stamp;
    out.length = 0;
    const bi0 = Math.max(0, Math.floor(x0 / L.B)), bi1 = Math.min(L.bc - 1, Math.floor((x0 + w) / L.B));
    const bj0 = Math.max(0, Math.floor(y0 / L.B)), bj1 = Math.min(L.bn - 1, Math.floor((y0 + h) / L.B));
    for (let bj = bj0; bj <= bj1; bj++) for (let bi = bi0; bi <= bi1; bi++) {
      for (const idx of L.tb[bj * L.bc + bi]) {
        if (L.seen[idx] === stamp) continue;
        L.seen[idx] = stamp;
        out.push(idx);
      }
    }
    return { bi0, bi1, bj0, bj1 };
  }
  function strokeLayer(ctx, L, x0, y0, S, out, wThin) {
    const span = gather(L, x0, y0, S, S, out);
    // one path per width: a few hundred traces become two stroke calls
    for (const wide of [false, true]) {
      ctx.lineWidth = wide ? 2.4 : wThin;
      ctx.beginPath();
      for (const idx of out) {
        const t = L.traces[idx];
        if ((t.w > 2) !== wide || t.fib) continue;
        ctx.moveTo(t.p[0][0], t.p[0][1]);
        for (let k = 1; k < t.p.length; k++) ctx.lineTo(t.p[k][0], t.p[k][1]);
      }
      ctx.stroke();
    }
    return span;
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
  // One-off signals: the page puts pulses onto a named line (the enquiry form does, as it is typed
  // in and when it is sent), and whichever circuits listen to that line carry them and light up.
  const bus = {};
  function fire(name, n = 1, dt = 0.09) {
    const q = bus[name] || (bus[name] = []);
    while (q.length && (q[0] < chargeT - 12 || q.length > 90)) q.shift();
    const t0 = Math.max(chargeT, q.length ? q[q.length - 1] + 0.05 : 0);
    for (let k = 0; k < n; k++) q.push(t0 + k * dt);
    kick();
  }

  function runCharges(ctx, L, list, time, A, sharp, col, only) {
    for (const idx of list) {
      const t = L.traces[idx];
      // `only` the printed circuits; and a circuit's switched current runs only while it is switched on
      if (!t.ch || (only && !t.net) || (t.gate && !t.gate.on)) continue;
      for (const c of t.ch) {
        if (!c.ev) spark(ctx, t, (c.ph + c.sp * time) % c.per, c.rev, A, sharp, col);
        else if (bus[c.ev]) for (const t0 of bus[c.ev]) spark(ctx, t, c.sp * (time - t0) - c.off, c.rev, A, sharp, col);
      }
    }
  }
  // one charge, s along its trace: a bright head and the tail it leaves
  function spark(ctx, t, s, rev, A, sharp, col) {
    if (s < 0 || s > t.L) return;                       // not on this wire: resting between pulses, or not there yet
    const ramp = t.net ? 5 : 16, reach = t.net ? 13 : 30;        // a circuit's wires are short and its pulses close together
    const a = A * Math.min(1, s / ramp, (t.L - s) / ramp);
    if (a < 0.03) return;
    if (rev) s = t.L - s;
    const tail = Math.min(reach, t.L * 0.45);
    const s0 = rev ? Math.min(t.L, s + tail) : Math.max(0, s - tail);
    const pts = subPath(t, s0, s), q = pts[0], h = pts[pts.length - 1];
    if (Math.abs(h[0] - q[0]) + Math.abs(h[1] - q[1]) > 0.5) {
      const gr = ctx.createLinearGradient(q[0], q[1], h[0], h[1]);
      gr.addColorStop(0, `rgba(${col.tail},0)`);
      gr.addColorStop(1, `rgba(${col.tail},${(0.95 * a).toFixed(3)})`);
      ctx.strokeStyle = gr;
      ctx.lineWidth = t.w > 2 ? 2.6 : 1.6;
      ctx.beginPath(); ctx.moveTo(q[0], q[1]);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.stroke();
    }
    if (sharp) {
      ctx.fillStyle = `rgba(${col.halo},${(0.45 * a).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(h[0], h[1], 3.8, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = `rgba(${col.head},${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(h[0], h[1], sharp ? 1.5 : 1.8, 0, TAU); ctx.fill();
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
        runCharges(octx, net.top, vis.top, chargeT, chargeA, true, pal);
        const s = IN_S;
        octx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (vx * (1 - s) - ox), dpr * (vy * (1 - s) - oy));
        runCharges(octx, net.inner, vis.inner, chargeT, chargeA * 0.5, false, pal);
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

    // Into the tiles: first the current running on its own wherever the board is on screen (in the
    // printed circuits; on a touch screen, in all of the copper), then whatever the light is showing.
    const M = 90, y0 = -br.top - M, y1 = innerHeight - br.top + M;
    let run = chargeA > 0.01;
    if (run) {
      gather(net.top, 0, y0, net.W, y1 - y0, vis.run);
      if (!flow) run = vis.run.some(i => net.top.traces[i].net);
    }
    for (const t of tiles) {
      const a = Math.max(t.y, y0), b = Math.min(t.y + t.h, y1), runs = run && b > a;
      const hit = lit && oy + S > t.y && oy < t.y + t.h;
      if (t.ctx) {
        if (t.box) { t.ctx.clearRect(t.box[0], t.box[1], t.box[2], t.box[3]); t.box = null; }
        if (t.rbox) { t.ctx.clearRect(t.rbox[0], t.rbox[1], t.rbox[2], t.rbox[3]); t.rbox = null; }
      }
      if (!runs && !hit) {
        if (t.ctx && Math.abs(t.y + t.h / 2 - (y0 + y1) / 2) > 2000) sleep(t);
        continue;
      }
      wake(t);
      const c = t.ctx;
      if (runs) {
        t.rbox = [0, a - t.y, net.W, b - a];
        c.save();
        c.beginPath(); c.rect(0, a - t.y, net.W, b - a); c.clip();
        c.translate(0, -t.y);
        c.lineCap = 'round'; c.lineJoin = 'round';
        runCharges(c, net.top, vis.run, chargeT, chargeA, true, pal.run, !flow);
        c.restore();
      }
      if (hit) {
        const y = oy - t.y;
        if (t.clip) { c.save(); c.translate(0, -t.y); c.clip(t.clip, 'evenodd'); c.translate(0, t.y); }
        // the board itself glowing where the light is
        const glow = c.createRadialGradient(lx, ly - t.y, 0, lx, ly - t.y, G);
        for (const [at, rgb, al] of pal.glow) glow.addColorStop(at, `rgba(${rgb},${(al * I).toFixed(3)})`);
        c.fillStyle = glow; c.fillRect(ox, y, S, S);
        c.drawImage(off, 0, 0, off.width, off.height, ox, y, S, S);
        if (t.clip) c.restore();
        t.box = [ox - 2, y - 2, S + 4, S + 4];
      }
    }
    runLeds(br);

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

  // The circuits' LEDs. Each is lit when its own circuit says so: the power LED while the board
  // is on, a driven LED from when its pulse arrives, the light switch's when light actually falls
  // on its photodiode (the cursor's light, or on a touch screen the middle of the screen).
  function runLeds(br) {
    const leds = net.leds;
    if (!leds.length) return;
    const top = -br.top - 80, bottom = innerHeight - br.top + 80, live = light.on && chargeA > 0.5;
    for (const d of leds) {
      if (d.y < top || d.y > bottom) continue;
      let on = false;
      if (d.win === 'on') on = light.on;
      else if (d.win === 'light') {
        on = live && (flow ? Math.abs(d.sy + br.top - innerHeight / 2) < innerHeight * 0.2
          : light.i > 0.3 && Math.hypot(light.x - br.left - d.sx, light.y - br.top - d.sy) < light.r * 0.8);
      } else if (live) {
        const t = chargeT - d.o.tOff;
        for (const [T, t0, dur] of d.win) if ((((t - t0) % T) + T) % T < dur) { on = true; break; }
        // and for a moment after each fired signal reaches it
        if (!on && d.ev) for (const [name, delay, dur] of d.ev) {
          for (const t0 of bus[name] || []) { const x = chargeT - t0 - delay; if (x >= 0 && x < dur) { on = true; break; } }
        }
      }
      if (on !== d.on) { d.on = on; d.el.classList.toggle('is-on', on); }
    }
  }

  /* ------------------------------------------------------------------ depth */

  // the far side of each hole, projected toward the screen centre: a soft sliver of bore
  // wall shows on the side away from you and shifts as the board scrolls past
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
    // the project strip runs edge to edge, so the margin marker steps aside while it passes
    if (railv) railv.classList.toggle('is-under', under);
  }

  /* ------------------------------------------------------------------ loop */

  function frame(now) {
    raf = 0;
    // once nobody is moving the pointer or scrolling, 30 frames a second is plenty for a drifting light,
    // and it is always plenty for current running on its own
    if (lastPaint && now - lastPaint < 30 && (flow || now - lastInput > 700) && !warmFrom) {
      raf = requestAnimationFrame(frame);
      return;
    }
    lastPaint = now;
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    const ease = k => (reduce ? 1 : 1 - Math.pow(1 - k, dt * 60));   // frame-rate independent

    // left alone, the light drifts off across the board; touch or move and it comes straight back.
    // After a minute it stops where it is, so an untouched tab costs nothing.
    const resting = !reduce && now - lastInput > (flow ? FLOW_REST : REST_AFTER);
    if (!resting && !flow) {
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
    const target = light.on && !flow ? 1 : 0;
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
    const st = flow ? 0 : Math.min(1.6, sv / 1400);             // on a phone it just flows, steadily
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
      || chargeA > 0
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
    if (!quiet) store.set('nyna-backlight', on ? 'on' : 'off');
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

  // Squared-off honeycomb: a hex lattice trimmed to a clean rectangle. The top and bottom rows and
  // the ends of every other row are cut through their centres, so each field has straight edges,
  // like a machined vent. Three cell sizes, chosen per field in CSS with --hex (s, m or l).
  const HEX = { s: [15, 11.4], m: [20, 15.6], l: [26, 20.6] };     // lattice pitch, hex radius (px)
  function clipPoly(pts, x0, y0, x1, y1) {
    const edges = [
      [q => q[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
      [q => q[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
      [q => q[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
      [q => q[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]
    ];
    let out = pts;
    for (const [inside, cut] of edges) {
      const src = out;
      out = [];
      for (let k = 0; k < src.length; k++) {
        const a = src[k], b = src[(k + 1) % src.length], ia = inside(a), ib = inside(b);
        if (ia) out.push(a);
        if (ia !== ib) out.push(cut(a, b));
      }
      if (!out.length) break;
    }
    return out;
  }
  const polyArea = pts => {
    let a = 0;
    for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(a) / 2;
  };
  function buildPerfs() {
    perfs.length = 0;
    $$('.perf').forEach(el => {
      const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight);
      if (w < 30 || h < 30) return;
      // The lattice is spaced a hair wider or narrower (never more than a few percent) so it fills
      // the field exactly: the silkscreen frame round it then lands on the element's own edges,
      // flush with the text column. Rows stay an even number, the same cut top and bottom.
      const O = 7, fw = w - 2 * O, fh0 = h - 2 * O;
      const order = ['l', 'm', 's'];
      let size = getComputedStyle(el).getPropertyValue('--hex').trim() || 's', sp, r, dx, dy, cols, rows;
      for (let k = Math.max(0, order.indexOf(size)); k < order.length; k++) {
        size = order[k];
        [sp, r] = HEX[size];
        const dx0 = Math.sqrt(3) * sp, dy0 = 1.5 * sp;
        cols = Math.round(fw / dx0);
        if (cols > 1 && fw / cols < dx0 * 0.93) cols--;
        rows = 2 * Math.round(fh0 / dy0 / 2);
        if (rows > 2 && fh0 / rows < dy0 * 0.93) rows -= 2;
        dx = fw / cols; dy = Math.min(dy0 * 1.2, Math.max(dy0 * 0.93, fh0 / rows));
        if (cols >= 1 && rows >= 2 && dx >= dx0 * 0.93 && rows * dy <= fh0 + 0.5) break;
        cols = 0;
      }
      if (cols < 1 || rows < 2) return;
      const hw = r * Math.sqrt(3) / 2, fh = rows * dy, ox = O, oy = (h - fh) / 2;
      const full = 3 * Math.sqrt(3) / 2 * r * r, polys = [];
      for (let row = 0; row <= rows; row++) {
        const cy = oy + row * dy, odd = row % 2;
        for (let c = 0; c < (odd ? cols : cols + 1); c++) {
          const cx = ox + (odd ? dx / 2 : 0) + c * dx;
          const pts = clipPoly([[cx + hw, cy + r / 2], [cx, cy + r], [cx - hw, cy + r / 2], [cx - hw, cy - r / 2], [cx, cy - r], [cx + hw, cy - r / 2]], ox, oy, ox + fw, oy + fh);
          if (pts.length > 2 && polyArea(pts) > full * 0.12) polys.push(pts);
        }
      }
      const f = n => Math.round(n * 10) / 10;
      const d = polys.map(pts => 'M' + pts.map(q => f(q[0]) + ' ' + f(q[1])).join('L') + 'Z').join('');
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
      perfs.push({ el, polys, field: [ox, oy, fw, fh] });
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
      // start in the empty space above the heading: the gap before the section, or its top padding
      // (on a case study that gap holds a row of circuits, and the column stands beside the row)
      const prev = host.previousElementSibling, pr = prev && prev.getBoundingClientRect();
      const gap = !prev ? 0 : hr.top - (prev.classList.contains('kit') && host.classList.contains('case-sec') ? pr.top : pr.bottom);
      const top = back ? back.getBoundingClientRect().top - hr.top
        : gap > 60 ? -(gap - 40)
        : Math.max(0, (h.top - hr.top) - Math.min(110, (h.top - hr.top) * 0.55));
      // run on past the heading, down to just above whatever comes next, never into it
      const next = el.nextElementSibling, headBottom = h.bottom - hr.top;
      const limit = next && next.getBoundingClientRect().height ? next.getBoundingClientRect().top - hr.top - 44 : headBottom + 260;
      const bottom = Math.max(headBottom, Math.min(limit, headBottom + 260));
      if (bottom - top < 110) { el.style.setProperty('--side-h', '0px'); return; }
      el.style.setProperty('--side-top', top.toFixed(0) + 'px');
      el.style.setProperty('--side-h', (bottom - top).toFixed(0) + 'px');
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
    const poly = (pts, dx, dy) => 'M' + pts.map(q => f(q[0] + dx) + ' ' + f(q[1] + dy)).join('L') + 'Z';
    const circ = (cx, cy, r) => `M${f(cx + r)} ${f(cy)}A${r} ${r} 0 1 0 ${f(cx - r)} ${f(cy)}A${r} ${r} 0 1 0 ${f(cx + r)} ${f(cy)}Z`;
    const rrect = (x, y, w, h, q) => `M${f(x + q)} ${f(y)}H${f(x + w - q)}A${q} ${q} 0 0 1 ${f(x + w)} ${f(y + q)}V${f(y + h - q)}A${q} ${q} 0 0 1 ${f(x + w - q)} ${f(y + h)}H${f(x + q)}A${q} ${q} 0 0 1 ${f(x)} ${f(y + h - q)}V${f(y + q)}A${q} ${q} 0 0 1 ${f(x + q)} ${f(y)}Z`;
    let cut = '', lip = '';
    for (const p of perfs) {
      const r = p.el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const x0 = r.left - br.left, y0 = r.top - br.top;
      for (const pts of p.polys) {
        const d = poly(pts, x0, y0);
        let lo = Infinity, hi = -Infinity;
        for (const q of pts) { if (q[1] < lo) lo = q[1]; if (q[1] > hi) hi = q[1]; }
        cut += d; lip += poly(pts, x0, y0 + WALL);
        holes.push({ y0: y0 + lo, y1: y0 + hi, d });
      }
    }
    // the drills of the parts' through-hole pads go right through the board too
    for (const [cx, cy, r] of net.drills || []) {
      const d = circ(cx, cy, r);
      cut += d; lip += circ(cx, cy + 1.2, r);
      holes.push({ y0: cy - r, y1: cy + r, d });
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

  /* ------------------------------------------------------------------ silkscreen */

  // Everything printed on top of the mask: the circuits (pads, outlines, references, names and
  // LEDs), and a keep-out frame with a reference around each honeycomb field. Drawn once per layout.
  function buildSilk() {
    silkSvg = null;
    if (!net) return;
    const br = board.getBoundingClientRect(), f = n => Math.round(n * 10) / 10;
    let art = '', text = '';
    const ref = (x, y, s) => { text += `<text class="k-ref" x="${f(x)}" y="${f(y)}">${s}</text>`; };
    // the circuits, each in its own coordinates at the page's scale, and the fibre between two of them
    for (const o of net.kits) art += `<g transform="translate(${o.ox} ${o.oy}) scale(${o.k})">${kitArt(o.M, o.refs, o.hide)}</g>`;
    for (const t of net.fibres) art += fibreArt(t.p, 2.4 * t.k);
    for (const n of net.notes) text += `<text class="k-net" x="${f(n.x)}" y="${f(n.y)}" text-anchor="middle" style="font-size:${f(7.5 * n.k)}px">${n.text}</text>`;
    // over everything, the lit lens and glow of each LED, switched as its circuit runs
    let lit = '';
    for (const d of net.leds) {
      lit += `<g class="k-led" transform="translate(${f(d.x)} ${f(d.y)}) scale(${d.k})${d.q ? ` rotate(${d.q * 90})` : ''}"><circle class="k-halo" r="${d.P.glow}"/>`
        + (d.P.lens ? `<path class="k-lit" d="${d.P.lens}"/>` : '') + (d.P.wave ? `<path class="k-wave" d="${d.P.wave}"/>` : '') + '</g>';
    }
    perfs.forEach((p, k) => {
      const r = p.el.getBoundingClientRect();
      if (!r.width) return;
      const [ox, oy, fw, fh] = p.field, o = 7;
      const x = r.left - br.left + ox - o, y = r.top - br.top + oy - o;
      art += `<rect class="k-silk" x="${f(x)}" y="${f(y)}" width="${f(fw + 2 * o)}" height="${f(fh + 2 * o)}" rx="3"/>`;
      ref(x, y - 6, 'V' + (k + 1));
    });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'silk');
    svg.setAttribute('width', net.W); svg.setAttribute('height', net.H);
    svg.setAttribute('viewBox', `0 0 ${net.W} ${net.H}`);
    svg.innerHTML = '<defs><radialGradient id="led-halo"><stop offset="0" style="stop-color:var(--glow);stop-opacity:.75"/>'
      + '<stop offset=".4" style="stop-color:var(--glow);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--glow);stop-opacity:0"/></radialGradient></defs>'
      + art + text + lit;
    const els = svg.querySelectorAll('.k-led');
    net.leds.forEach((d, i) => { d.el = els[i]; d.on = false; });
    silkSvg = svg;
  }

  // the footer's dimension line reports its own length, as a drawing would
  const dimVal = $('#dim-val');
  function updateDims() {
    if (!dimVal || !dimVal.parentElement) return;
    const w = dimVal.parentElement.getBoundingClientRect().width;
    dimVal.textContent = (w * 25.4 / 96).toFixed(2) + ' mm';
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
 vec4 c0=vec4(.82,.95,1.,1.), c1=vec4(.47,.847,1.,.95), c2=vec4(.122,.753,1.,.8), c3=vec4(0.,.557,.859,.36), c4=vec4(0.,.557,.859,0.);
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
      gl.uniform3f(U.uLine, 0.2, 0.76, 1);
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
    const src = key => `/assets/boards/${key}-cast.webp?v=42`;            // each picture carries its own shadow
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
        const vRef = $('#viewer-ref');
        if (vRef) vRef.textContent = b.textContent.trim().toUpperCase();
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
    // the strip only fades out at a side that still has boards hidden past it
    const edges = () => {
      if (!win) return;
      const m = maxScroll(), s = panel.scrollLeft - tx;
      win.style.setProperty('--bl', Math.max(0, Math.min(1, s / 70)).toFixed(3));
      win.style.setProperty('--br', Math.max(0, Math.min(1, (m - s) / 70)).toFixed(3));
    };
    // the track under the window shows how far along you are, and the counter which boards are in view
    const pos = $('.panel-pos'), count = $('#panel-count');
    const two = n => String(n).padStart(2, '0');
    const progress = () => {
      const m = maxScroll(), at = Math.max(0, Math.min(m, panel.scrollLeft - tx));
      if (pos) {
        pos.style.setProperty('--pp', (m ? at / m : 0).toFixed(4));
        pos.style.setProperty('--pw', Math.min(1, panel.clientWidth / Math.max(1, panel.scrollWidth)).toFixed(4));
      }
      if (!count) return;
      const pr = panel.getBoundingClientRect(), mid = pr.left + pr.width / 2;
      let a = 0, b = 0, near = 1, best = Infinity;
      boards.forEach((el, i) => {
        const r = el.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid);
        if (r.left >= pr.left - 6 && r.right <= pr.right + 6) { if (!a) a = i + 1; b = i + 1; }
        if (d < best) { best = d; near = i + 1; }
      });
      if (!a) a = b = near;                               // too narrow to hold a whole board: the one in the middle
      const text = a === b ? two(a) : two(a) + '-' + two(b);
      if (count.textContent !== text) count.textContent = text;
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
    panel.addEventListener('scroll', () => { edges(); progress(); litDirty = true; kick(); if (!anim) updateArrows(); }, { passive: true });
    addEventListener('resize', () => { edges(); progress(); }, { passive: true });
    updateArrows();
    edges();
    progress();

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

    // each field's LED lights once it holds something usable, and the send key's once there is enough to send
    const done = { name: () => !!fName.value.trim(), email: () => validEmail(fEmail.value.trim()), msg: () => !!fMsg.value.trim() };
    const mark = () => {
      for (const [f, ok] of [[fName, done.name()], [fEmail, done.email()], [fMsg, done.msg()]]) f.closest('.field').classList.toggle('is-set', ok);
      form.classList.toggle('is-ready', done.email() && done.msg());
    };
    // what is typed goes out through the board's radio as it is typed: a pulse a keystroke
    let lastKey = 0;
    const typed = () => {
      const t = performance.now();
      if (t - lastKey > 85) { lastKey = t; fire('tx'); }
      active();
    };
    form.addEventListener('input', () => { mark(); typed(); });
    form.addEventListener('change', mark);
    fEmail.addEventListener('blur', () => { if (fEmail.value.trim()) setErr(fEmail, !checkEmail()); });
    fEmail.addEventListener('input', () => { if (fEmail.getAttribute('aria-invalid') === 'true' && checkEmail()) setErr(fEmail, false); });
    fMsg.addEventListener('input', () => { if (fMsg.getAttribute('aria-invalid') === 'true' && fMsg.value.trim()) setErr(fMsg, false); });
    mark();                                             // a browser may have put back what was typed before
    addEventListener('pageshow', mark);

    form.addEventListener('submit', e => {
      e.preventDefault();
      const email = fEmail.value.trim(), msg = fMsg.value.trim(), name = fName.value.trim();
      const badEmail = !checkEmail(), badMsg = !msg;
      setErr(fEmail, badEmail); setErr(fMsg, badMsg);
      if (badEmail) { fEmail.focus(); return; }
      if (badMsg) { fMsg.focus(); return; }

      const services = $$('.key input:checked', form).map(b => b.value);
      const subject = 'Project enquiry' + (services.length ? ': ' + services.join(', ') : '');
      const lines = [msg, ''];
      if (services.length) lines.push('Services: ' + services.join(', '));
      if (name) lines.push('From: ' + name);
      lines.push('Reply to: ' + email);
      window.location.href = 'mailto:info@nyna.co.uk?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
      status.textContent = 'Your email app should open with the enquiry ready. Press send there to deliver it.';
      fire('tx', 16, 0.08);                                         // the whole frame goes out,
      if (light.on && !reduce) { light.boost = 1.1; active(); }     // and the board lights up as it goes
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
    $$('.chip-inc li, .bom li, .feat, .leds li, .direct > div').forEach(el => lit.observe(el));
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
    buildSilk();
    buildTiles();
    watchLight();
    updateDims();
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
    if (flow) { light.i = 0; light.r = light.tr; kick(); }
    else if (reduce) { light.i = light.on ? 1 : 0; light.r = light.tr; kick(); }
    else setTimeout(() => { warmFrom = performance.now(); lastInput = warmFrom; kick(); }, 280);
  }
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(start);
})();
