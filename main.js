/* nelvo.ca v8: nav state, ensō scroll turn, phone menu, reveals */
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

  /* mobile menu */
  const burger = document.querySelector('.burger');
  if (burger) {
    /* the bars turn into an X while the menu is open; the X, the Escape key or a link closes it, and the page stays where it was */
    const setMenu = open => {
      document.body.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', open);
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    };
    burger.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
    document.querySelectorAll('.menu-overlay a').forEach(a =>
      a.addEventListener('click', () => setMenu(false))
    );
    addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { setMenu(false); burger.focus(); }
    });
  }

  /* reveals */
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });
  document.querySelectorAll('.rv').forEach(el => io.observe(el));

})();
