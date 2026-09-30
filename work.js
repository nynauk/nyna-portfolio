/* NYNA: case studies.
   The photo viewer, the turning 3D optics on the OWC page, and the interactive
   strategy chart on the trading page. main.js runs the board itself. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

  /* ------------------------------------------------------------------ photo viewer */

  const shots = $$('[data-zoom]');
  if (shots.length) {
    const lb = document.createElement('div');
    lb.className = 'lb';
    lb.hidden = true;
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Image viewer');
    lb.innerHTML = `<img class="lb-img" alt="">`
      + `<button class="lb-btn lb-close" type="button" aria-label="Close">${icon('M6 6l12 12M18 6L6 18')}</button>`
      + (shots.length > 1 ? `<button class="lb-btn lb-prev" type="button" aria-label="Previous image">${icon('M15 5l-7 7 7 7')}</button>`
        + `<button class="lb-btn lb-next" type="button" aria-label="Next image">${icon('M9 5l7 7-7 7')}</button>` : '')
      + `<p class="lb-cap"></p>`;
    document.body.appendChild(lb);
    const img = $('.lb-img', lb), cap = $('.lb-cap', lb), closeBtn = $('.lb-close', lb);
    let at = 0, back = null, outT = 0;
    const show = i => {
      at = (i + shots.length) % shots.length;
      const s = shots[at], alt = (s.querySelector('img') || {}).alt || '';
      img.src = s.dataset.zoom;
      img.alt = alt;
      cap.textContent = alt;
    };
    const open = i => {
      clearTimeout(outT);
      back = document.activeElement;
      show(i);
      lb.hidden = false;
      requestAnimationFrame(() => lb.classList.add('is-on'));
      document.documentElement.style.overflow = 'hidden';
      closeBtn.focus({ preventScroll: true });
    };
    const close = () => {
      if (lb.hidden) return;
      lb.classList.remove('is-on');
      document.documentElement.style.overflow = '';
      outT = setTimeout(() => { lb.hidden = true; img.removeAttribute('src'); }, reduce ? 0 : 260);
      if (back && back.focus) back.focus({ preventScroll: true });
    };
    shots.forEach((s, i) => s.addEventListener('click', () => open(i)));
    closeBtn.addEventListener('click', close);
    if (shots.length > 1) {
      $('.lb-prev', lb).addEventListener('click', () => show(at - 1));
      $('.lb-next', lb).addEventListener('click', () => show(at + 1));
    }
    lb.addEventListener('click', e => { if (e.target === lb) close(); });
    addEventListener('keydown', e => {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && shots.length > 1) show(at + 1);
      else if (e.key === 'ArrowLeft' && shots.length > 1) show(at - 1);
      else if (e.key === 'Tab') {
        const f = $$('button', lb), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    // a swipe moves between photos on a phone
    let sx = null;
    lb.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => {
      if (sx === null || shots.length < 2) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1));
      sx = null;
    }, { passive: true });
  }

  /* ------------------------------------------------------------------ 3D optics */

  // The printed adapters, turning slowly in a window cut through the board. Drag to spin one.
  const cv = $('#adapters');
  if (cv) {
    const stage = cv.closest('.model-stage');
    const tabs = $$('[data-adapter]');
    const fallback = $('.model-fallback', stage);
    const RENDERS = { final: 'render_final_adapter', bpw34: 'render_bpw34_adapter', coupler: 'render_laser_adapter', toslink_led: 'render_laser_module', toslink: 'render_laser_adapter' };
    const pick = key => {
      tabs.forEach(t => t.setAttribute('aria-pressed', String(t.dataset.adapter === key)));
      if (fallback) fallback.src = `/projects/${RENDERS[key] || 'render_final_adapter'}.png`;
    };
    tabs.forEach(t => t.addEventListener('click', () => { pick(t.dataset.adapter); if (viewer) viewer.load(t.dataset.adapter); }));
    let viewer = null;
    const boot = async () => {
      let THREE, GLTFLoader, RoomEnvironment;
      try {
        THREE = await import('three');
        ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
        ({ RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js'));
      } catch (e) { return; }                       // offline or blocked: the render image stays
      const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
      let w = stage.clientWidth || 600, h = stage.clientHeight || 400;
      r.setSize(w, h, false);
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
      cam.position.set(0, 0.45, 5.4); cam.lookAt(0, 0, 0);
      try { const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; } catch (e) { /* no environment light */ }
      scene.add(new THREE.AmbientLight(0xffffff, 0.58));
      const d1 = new THREE.DirectionalLight(0xffffff, 1.55); d1.position.set(5, 3.5, 4); scene.add(d1);
      const d2 = new THREE.DirectionalLight(0x5ECFF9, 1.0); d2.position.set(-5, 1, -4); scene.add(d2);
      const d3 = new THREE.DirectionalLight(0x9BE4FF, 0.45); d3.position.set(0, -4, 2); scene.add(d3);
      const grp = new THREE.Group(); scene.add(grp);
      // the look of an FDM print: layer ridges and a matte speckle
      const bc = document.createElement('canvas'); bc.width = bc.height = 512;
      const bx = bc.getContext('2d');
      for (let y = 0; y < 512; y++) { const v = Math.round(128 + Math.sin(y / 512 * 6.2831 * 74) * 46); bx.fillStyle = `rgb(${v},${v},${v})`; bx.fillRect(0, y, 512, 1); }
      const id = bx.getImageData(0, 0, 512, 512), px = id.data;
      for (let i = 0; i < px.length; i += 4) { const n = (Math.random() - 0.5) * 48; px[i] += n; px[i + 1] += n; px[i + 2] += n; }
      bx.putImageData(id, 0, 0);
      const bump = new THREE.CanvasTexture(bc); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.anisotropy = 4;
      const mat = new THREE.MeshStandardMaterial({ color: 0xc7ced7, roughness: 0.72, metalness: 0.08, bumpMap: bump, bumpScale: 0.22, roughnessMap: bump, envMapIntensity: 0.95 });
      const loader = new GLTFLoader();
      let token = 0, current = null;
      const load = key => {
        const my = ++token;
        loader.load(`/models/adapter_${key}.glb`, gltf => {
          if (my !== token) return;
          const mdl = gltf.scene;
          mdl.traverse(o => {
            if (!o.isMesh) return;
            o.material = mat;
            const g = o.geometry;
            if (!g.attributes.normal) g.computeVertexNormals();
            g.computeBoundingBox();
            const bb = g.boundingBox, sx = Math.max(1e-4, bb.max.x - bb.min.x), sy = Math.max(1e-4, bb.max.y - bb.min.y);
            const P = g.attributes.position, uv = new Float32Array(P.count * 2);
            for (let q = 0; q < P.count; q++) { uv[q * 2] = (P.getX(q) - bb.min.x) / sx; uv[q * 2 + 1] = (P.getY(q) - bb.min.y) / sy; }
            g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
          });
          const box = new THREE.Box3().setFromObject(mdl), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
          mdl.position.sub(c);
          const inner = new THREE.Group(); inner.add(mdl);
          inner.scale.setScalar(2.5 / Math.hypot(sz.x, sz.y, sz.z));
          if (key === 'final') inner.rotation.z = Math.PI / 2;
          if (current) grp.remove(current);
          grp.add(inner); current = inner;
          stage.classList.add('has3d');
        });
      };
      // drag sideways to spin; vertical drags still scroll the page on a phone
      let drag = false, px0 = 0, py0 = 0, axis = 0, tiltT = 0, tilt = 0;
      stage.addEventListener('pointerdown', e => {
        drag = true; px0 = e.clientX; py0 = e.clientY; axis = e.pointerType === 'touch' ? 0 : 1;
        if (axis === 1) { try { stage.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } }
      });
      stage.addEventListener('pointermove', e => {
        const b = stage.getBoundingClientRect();
        tiltT = ((e.clientY - b.top) / b.height) * 2 - 1;
        if (!drag) return;
        if (axis === 0) {
          const ax = Math.abs(e.clientX - px0), ay = Math.abs(e.clientY - py0);
          if (ax > 4 || ay > 4) {
            if (ax >= ay) { axis = 1; try { stage.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } }
            else { drag = false; return; }
          }
        }
        if (axis === 1) { grp.rotation.y += (e.clientX - px0) * 0.01; px0 = e.clientX; }
      });
      const end = () => { drag = false; axis = 0; };
      addEventListener('pointerup', end);
      stage.addEventListener('pointercancel', end);
      stage.addEventListener('pointerleave', () => { tiltT = 0; });
      new ResizeObserver(() => {
        w = stage.clientWidth; h = stage.clientHeight;
        if (w && h) { cam.aspect = w / h; cam.updateProjectionMatrix(); r.setSize(w, h, false); }
      }).observe(stage);
      let vis = true;
      new IntersectionObserver(es => { vis = es[0].isIntersecting; }, { threshold: 0 }).observe(stage);
      const clock = new THREE.Clock();
      (function loop() {
        requestAnimationFrame(loop);
        if (document.hidden || !vis) { clock.getDelta(); return; }
        const dt = Math.min(0.05, clock.getDelta());
        if (!drag && !reduce) grp.rotation.y += dt * 0.4;
        tilt += (tiltT - tilt) * 0.06;
        grp.rotation.x += ((-0.1 + tilt * 0.3) - grp.rotation.x) * 0.1;
        r.render(scene, cam);
      })();
      viewer = { load };
      const on = tabs.find(t => t.getAttribute('aria-pressed') === 'true');
      load(on ? on.dataset.adapter : 'final');
    };
    // only fetch three.js when the viewer is about to be seen
    new IntersectionObserver((es, io) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      boot();
    }, { rootMargin: '300px 0px' }).observe(stage);
  }

  /* ------------------------------------------------------------------ strategy chart */

  // Illustrative candles for each strategy, with its entries, stops and targets marked,
  // a hover read-out, headline stats and a small equity curve.
  const tv = $('#tvCanvas');
  const S = window.NYNA_STRATS;
  if (tv && S && S.length) {
    const ctx = tv.getContext('2d');
    const nameEl = $('#tvName'), descEl = $('#tvDesc'), tip = $('#tvTip'), sw = $('#tvSwitch'), stEl = $('#tvStats');
    const eq = $('#tvEq'), ex = eq.getContext('2d');
    let cur = 0, geo = null, hover = -1;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const UP = '#2BBE8C', DN = '#E0566A', ACC = '#5ECFF9', GRID = 'rgba(150,170,190,.10)', AXIS = '#7D90A5';
    const FONT = '11px Archivo, system-ui, sans-serif';
    S.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s.name;
      b.setAttribute('aria-pressed', String(i === 0));
      b.addEventListener('click', () => select(i));
      sw.appendChild(b);
    });
    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath(); ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    };
    function stats(s) {
      const st = s.stats;
      if (!st) { stEl.innerHTML = ''; return; }
      const items = [['Win rate', st.wr + '%', ''], ['Profit factor', st.pf.toFixed(2), st.pf >= 1 ? 'pos' : 'neg'], ['Avg win', st.avgR + 'R', ''], ['Trades', String(st.trades), ''], ['Max DD', st.maxdd + 'R', 'neg']];
      stEl.innerHTML = items.map(x => `<div class="tv-stat"><span>${x[0]}</span><b class="${x[2]}">${x[1]}</b></div>`).join('');
    }
    function equity(s) {
      const e = s.equity;
      if (!e || !e.length) return;
      const w = eq.clientWidth, h = eq.clientHeight;
      if (!w || !h) return;
      eq.width = w * dpr; eq.height = h * dpr;
      ex.setTransform(dpr, 0, 0, dpr, 0, 0); ex.clearRect(0, 0, w, h);
      let lo = Math.min(...e), hi = Math.max(...e);
      if (hi - lo < 1) { hi += 1; lo -= 1; }
      const pd = (hi - lo) * 0.15; lo -= pd; hi += pd;
      const n = e.length, X = i => 2 + i * (w - 4) / (n - 1), Y = v => h - 2 - (v - lo) / (hi - lo) * (h - 4);
      if (lo < 0 && hi > 0) { ex.strokeStyle = 'rgba(150,170,190,.25)'; ex.setLineDash([3, 3]); ex.beginPath(); ex.moveTo(0, Y(0)); ex.lineTo(w, Y(0)); ex.stroke(); ex.setLineDash([]); }
      const up = e[n - 1] >= 0, col = up ? UP : DN;
      ex.beginPath(); ex.moveTo(X(0), Y(e[0])); e.forEach((v, i) => ex.lineTo(X(i), Y(v)));
      ex.lineTo(X(n - 1), Y(lo)); ex.lineTo(X(0), Y(lo)); ex.closePath();
      const gr = ex.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, up ? 'rgba(43,190,140,.28)' : 'rgba(224,86,106,.24)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ex.fillStyle = gr; ex.fill();
      ex.strokeStyle = col; ex.lineWidth = 1.8; ex.beginPath();
      e.forEach((v, i) => (i ? ex.lineTo(X(i), Y(v)) : ex.moveTo(X(i), Y(v))));
      ex.stroke();
    }
    function select(i) {
      cur = i;
      Array.from(sw.children).forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
      nameEl.textContent = S[i].name; descEl.textContent = S[i].desc;
      stats(S[i]); equity(S[i]);
      hover = -1; tip.hidden = true; draw();
    }
    function resize() {
      const w = tv.clientWidth, h = tv.clientHeight;
      if (!w || !h) return;
      tv.width = w * dpr; tv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(); equity(S[cur]);
    }
    function draw() {
      const s = S[cur], c = s.candles, ann = s.ann || {}, w = tv.clientWidth, h = tv.clientHeight;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      const x0 = 6, x1 = w - 64, y0 = 12, y1 = h - 20;
      let lo = 1e9, hi = -1e9;
      c.forEach(k => { lo = Math.min(lo, k[2]); hi = Math.max(hi, k[1]); });
      (ann.hlines || []).forEach(l => { lo = Math.min(lo, l.y); hi = Math.max(hi, l.y); });
      (ann.zones || []).forEach(z => { lo = Math.min(lo, z.y0); hi = Math.max(hi, z.y1); });
      const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
      const n = c.length, X = i => x0 + (i + 0.5) * (x1 - x0) / n, Y = p => y1 - (p - lo) / (hi - lo) * (y1 - y0);
      geo = { x0, x1, n };
      ctx.lineWidth = 1; ctx.font = FONT; ctx.textBaseline = 'middle';
      for (let g = 0; g <= 5; g++) {
        const p = lo + (hi - lo) * g / 5, yy = Y(p);
        ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
        ctx.fillStyle = AXIS; ctx.textAlign = 'left'; ctx.fillText(p.toFixed(4), x1 + 8, yy);
      }
      (ann.zones || []).forEach(z => {
        const zx0 = X(z.x0) - 4, zx1 = X(z.x1) + 4, zy0 = Y(z.y1), zy1 = Y(z.y0);
        ctx.fillStyle = 'rgba(94,207,249,.08)'; ctx.fillRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
        ctx.strokeStyle = 'rgba(94,207,249,.35)'; ctx.strokeRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
        ctx.fillStyle = 'rgba(94,207,249,.85)'; ctx.textBaseline = 'bottom'; ctx.fillText(z.label, zx0 + 2, zy0 - 3); ctx.textBaseline = 'middle';
      });
      const poly = (arr, col) => { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); arr.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke(); };
      if (ann.upline) poly(ann.upline, 'rgba(94,207,249,.5)');
      if (ann.loline) poly(ann.loline, 'rgba(150,162,175,.55)');
      if (ann.maline) poly(ann.maline, 'rgba(94,207,249,.5)');
      const cw = Math.max(2, (x1 - x0) / n * 0.6);
      c.forEach((k, i) => {
        const [o, hg, l, cl] = k, col = cl >= o ? UP : DN, xc = X(i);
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, cw * 0.14);
        ctx.beginPath(); ctx.moveTo(xc, Y(hg)); ctx.lineTo(xc, Y(l)); ctx.stroke();
        let a = Y(o), b = Y(cl);
        if (Math.abs(a - b) < 1.2) b = a - 1.2;
        ctx.fillStyle = col; ctx.fillRect(xc - cw / 2, Math.min(a, b), cw, Math.abs(a - b));
      });
      ctx.setLineDash([5, 4]);
      (ann.hlines || []).forEach(hl => {
        const up = hl.kind === 'entry' || hl.kind === 'target';
        const col = hl.kind === 'stop' ? DN : hl.kind === 'target' ? UP : hl.kind === 'entry' ? ACC : AXIS, yy = Y(hl.y);
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
        ctx.fillStyle = col; ctx.textBaseline = up ? 'bottom' : 'top'; ctx.fillText(hl.label, x0 + 4, yy + (up ? -3 : 3)); ctx.textBaseline = 'middle';
      });
      ctx.setLineDash([]);
      (ann.markers || []).forEach(m => {
        const xc = X(m.x), yy = Y(m.y), up = m.dir === 'up';
        ctx.fillStyle = ACC; ctx.beginPath();
        ctx.moveTo(xc, yy + (up ? 12 : -12)); ctx.lineTo(xc - 6, yy + (up ? 24 : -24)); ctx.lineTo(xc + 6, yy + (up ? 24 : -24));
        ctx.closePath(); ctx.fill();
        const tw = ctx.measureText(m.label).width, lx = Math.min(Math.max(xc - tw / 2, x0 + 2), x1 - tw - 2), ly = yy + (up ? 30 : -42);
        ctx.fillStyle = 'rgba(94,207,249,.14)'; ctx.strokeStyle = 'rgba(94,207,249,.5)';
        roundRect(lx - 7, ly - 3, tw + 14, 20, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#E9F6FB'; ctx.textBaseline = 'top'; ctx.fillText(m.label, lx, ly); ctx.textBaseline = 'middle';
      });
      if (hover >= 0 && hover < n) {
        const xc = X(hover), k = c[hover];
        ctx.strokeStyle = 'rgba(150,170,190,.3)'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xc, y0); ctx.lineTo(xc, y1); ctx.stroke(); ctx.setLineDash([]);
        tip.hidden = false;
        tip.innerHTML = `<b>O</b> ${k[0].toFixed(4)}&nbsp;&nbsp;<b>H</b> ${k[1].toFixed(4)}<br><b>L</b> ${k[2].toFixed(4)}&nbsp;&nbsp;<b>C</b> ${k[3].toFixed(4)}`;
        tip.style.left = Math.min(Math.max(xc, 64), w - 64) + 'px';
        tip.style.top = (y0 + 6) + 'px';
      } else tip.hidden = true;
    }
    const pointAt = x => {
      if (!geo) return -1;
      const r = tv.getBoundingClientRect(), i = Math.round((x - r.left - geo.x0) / ((geo.x1 - geo.x0) / geo.n) - 0.5);
      return Math.max(0, Math.min(geo.n - 1, i));
    };
    tv.addEventListener('pointermove', e => { const i = pointAt(e.clientX); if (i !== hover) { hover = i; draw(); } });
    tv.addEventListener('pointerleave', () => { hover = -1; tip.hidden = true; draw(); });
    let rt = 0;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 120); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    select(0); resize();
  }
})();
