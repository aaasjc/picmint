/**
 * PicMint — landing page interactions
 * No dependencies, no network calls. Everything is progressive enhancement:
 * the page is fully readable with JavaScript disabled.
 */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --------------------------------------------------------------------------
   Sticky navigation
   -------------------------------------------------------------------------- */

const nav = document.getElementById('nav');
const navToggle = document.getElementById('navToggle');

const syncNavState = () => {
  if (!nav) return;
  nav.classList.toggle('is-stuck', window.scrollY > 12);
};

syncNavState();
window.addEventListener('scroll', syncNavState, { passive: true });

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
  });

  nav.querySelectorAll('.nav__link').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

/* --------------------------------------------------------------------------
   Reveal on scroll
   -------------------------------------------------------------------------- */

const revealTargets = document.querySelectorAll('.reveal');

if (reduceMotion || !('IntersectionObserver' in window)) {
  revealTargets.forEach((el) => el.classList.add('is-in'));
} else {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
  );

  revealTargets.forEach((el) => revealObserver.observe(el));
}

/* --------------------------------------------------------------------------
   Number count-up
   -------------------------------------------------------------------------- */

const animateNumber = (el) => {
  const target = Number.parseFloat(el.dataset.count || '0');
  const suffix = el.dataset.suffix || '';
  if (!Number.isFinite(target) || target === 0) return;

  const duration = reduceMotion ? 0 : 1100;
  const start = performance.now();

  const tick = (now) => {
    const progress = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = `${Math.round(target * eased)}${suffix}`;
    if (progress < 1) requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
};

const counters = document.querySelectorAll('[data-count]');
if (counters.length) {
  if (!('IntersectionObserver' in window)) {
    counters.forEach(animateNumber);
  } else {
    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          animateNumber(entry.target);
          counterObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.6 }
    );
    counters.forEach((el) => counterObserver.observe(el));
  }
}

/* --------------------------------------------------------------------------
   Hero: compression bar fills once it is on screen
   -------------------------------------------------------------------------- */

const split = document.getElementById('demoSplit');
if (split) {
  const arm = () => {
    if (reduceMotion) {
      split.style.width = '26%';
      return;
    }
    requestAnimationFrame(() => split.classList.add('is-live'));
  };

  if ('IntersectionObserver' in window) {
    const splitObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          window.setTimeout(arm, 420);
          splitObserver.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    splitObserver.observe(split);
  } else {
    arm();
  }
}

/* --------------------------------------------------------------------------
   Feature cards: soft spotlight that follows the pointer
   -------------------------------------------------------------------------- */

if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
  document.querySelectorAll('.feature').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  });
}

/* --------------------------------------------------------------------------
   Footer year
   -------------------------------------------------------------------------- */

const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());
