/* NELVO v5 · "The Big Read" */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* nav state + ensō scroll rotation */
  const nav = document.querySelector('.nav');
  const spinners = [...document.querySelectorAll('[data-spin]')];
  const onScroll = () => {
    if (nav) nav.classList.toggle('scrolled', scrollY > 24);
    if (!reduce) {
      for (const el of spinners) {
        const sp = parseFloat(el.dataset.spin) || 0.02;
        el.style.transform = `rotate(${(scrollY * sp).toFixed(2)}deg)`;
      }
    }
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* home: align landing logo with hero text, slide back to corner on scroll */
  if (document.body.classList.contains('home')) {
    const navLogo = document.querySelector('.nav-logo');
    const heroWrap = document.querySelector('.hero .wrap');
    const setShift = () => {
      if (!navLogo || !heroWrap) return;
      navLogo.style.setProperty('--logo-shift', '0px');
      const logoLeft = navLogo.getBoundingClientRect().left;
      const heroLeft = heroWrap.getBoundingClientRect().left +
        parseFloat(getComputedStyle(heroWrap).paddingLeft);
      const shift = Math.max(0, heroLeft - logoLeft);
      navLogo.style.setProperty('--logo-shift', shift.toFixed(1) + 'px');
    };
    setShift();
    addEventListener('resize', setShift, { passive: true });
    addEventListener('load', setShift);
  }

  /* mobile menu */
  const burger = document.querySelector('.burger');
  if (burger) {
    burger.addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      burger.setAttribute('aria-expanded', open);
    });
    document.querySelectorAll('.menu-overlay a').forEach(a =>
      a.addEventListener('click', () => {
        document.body.classList.remove('menu-open');
        burger.setAttribute('aria-expanded', 'false');
      })
    );
  }

  /* counters */
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const runCount = el => {
    const target = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.decimals || '0', 10);
    const prefix = el.dataset.prefix || '';
    if (reduce) { el.textContent = prefix + target.toFixed(dec); return; }
    const dur = 1400;
    const t0 = performance.now();
    const tick = now => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = prefix + (target * easeOut(p)).toFixed(dec);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /* reveals */
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      e.target.querySelectorAll('[data-count]').forEach(runCount);
      io.unobserve(e.target);
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });
  document.querySelectorAll('.rv').forEach(el => io.observe(el));

  /* home hero: recolor terra letters to navy where they overlap the ensō brush */
  const eo_targets = [...document.querySelectorAll('.hero .h1 em, .hero .eyebrow, .hero .lede-lead em')];
  const eo_enso = document.querySelector('.hero-enso');
  if (eo_targets.length && eo_enso) {
    const NAVY = 'var(--ink)';
    const IMW = 940, IMH = 940;
    const spans = [];
    eo_targets.forEach(el => {
      const text = el.textContent;
      el.textContent = '';
      const wrap = document.createElement('span');
      wrap.className = 'eo-wrap';
      for (const ch of text) {
        if (ch === ' ') { wrap.appendChild(document.createTextNode(' ')); }
        else {
          const s = document.createElement('span');
          s.className = 'eo';
          s.textContent = ch;
          wrap.appendChild(s);
          spans.push(s);
        }
      }
      el.appendChild(wrap);
    });
    let alpha = null;
    const recolor = () => {
      if (!alpha) return;
      const hero = document.querySelector('.hero');
      if (hero && hero.getBoundingClientRect().bottom < 0) return;
      const rect = eo_enso.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const w = eo_enso.offsetWidth || rect.width, h = eo_enso.offsetHeight || rect.height;
      let a = 0;
      const tf = getComputedStyle(eo_enso).transform;
      if (tf && tf !== 'none') {
        const m = tf.match(/matrix\(([^)]+)\)/);
        if (m) { const v = m[1].split(',').map(parseFloat); a = Math.atan2(v[1], v[0]); }
      }
      const cosA = Math.cos(a), sinA = Math.sin(a);
      const STEPS = 4, M = 1.5, THRESH = 28;
      for (const s of spans) {
        const r = s.getBoundingClientRect();
        let navy = false;
        for (let gy = 0; gy <= STEPS && !navy; gy++) {
          for (let gx = 0; gx <= STEPS && !navy; gx++) {
            const px = r.left - M + (r.width + 2 * M) * (gx / STEPS);
            const py = r.top - M + (r.height + 2 * M) * (gy / STEPS);
            const dx = px - cx, dy = py - cy;
            const rx = dx * cosA + dy * sinA, ry = -dx * sinA + dy * cosA;
            const ix = Math.round((rx + w / 2) / w * IMW), iy = Math.round((ry + h / 2) / h * IMH);
            if (ix >= 0 && ix < IMW && iy >= 0 && iy < IMH && alpha[(iy * IMW + ix) * 4 + 3] >= THRESH) navy = true;
          }
        }
        s.style.color = navy ? NAVY : '';
      }
    };
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = IMW; c.height = IMH;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, IMW, IMH);
        alpha = x.getImageData(0, 0, IMW, IMH).data;
        recolor();
      } catch (e) { /* sampling unavailable */ }
    };
    img.src = 'nelvo-enso-textured.webp';
    let eo_raf = 0;
    const schedule = () => { if (eo_raf) return; eo_raf = requestAnimationFrame(() => { eo_raf = 0; recolor(); }); };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule, { passive: true });
    addEventListener('load', recolor);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(recolor);
  }
})();
