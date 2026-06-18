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
})();
