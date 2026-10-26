(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');
  root.dataset.siteRevision = 'engineering-01';
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.querySelector('#site-nav');
  const mobile = matchMedia('(max-width: 760px)');

  if (toggle && menu) {
    const setMenu = (open, restoreFocus = false) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      menu.classList.toggle('is-open', open);
      header?.classList.toggle('menu-open', open);
      if (restoreFocus) toggle.focus();
    };
    toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
    menu.addEventListener('click', event => {
      if (event.target.closest('a')) setMenu(false);
    });
    document.addEventListener('pointerdown', event => {
      if (toggle.getAttribute('aria-expanded') === 'true' && !header?.contains(event.target)) setMenu(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') setMenu(false, true);
    });
    document.addEventListener('focusin', event => {
      if (mobile.matches && toggle.getAttribute('aria-expanded') === 'true' && !header?.contains(event.target)) setMenu(false);
    });
    mobile.addEventListener('change', () => setMenu(false));
  }

  const progress = document.querySelector('.reading-progress');
  let scrollFrame = 0;
  const updateScroll = () => {
    scrollFrame = 0;
    header?.classList.toggle('is-scrolled', window.scrollY > 24);
    const distance = root.scrollHeight - window.innerHeight;
    const value = distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0;
    if (progress) progress.style.transform = `scaleX(${value})`;
  };
  const queueScroll = () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
  };
  window.addEventListener('scroll', queueScroll, { passive: true });
  window.addEventListener('resize', queueScroll, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(queueScroll).observe(document.body);
  updateScroll();

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const hasMotionEngine = [...document.scripts].some(script => /(?:^|\/)motion\.js(?:[?#]|$)/.test(script.src));
  if ('IntersectionObserver' in window && !reducedMotion.matches && !hasMotionEngine) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('reveal-pending');
        entry.target.classList.add('is-revealed');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: .06 });
    document.querySelectorAll('[data-reveal]').forEach(element => {
      if (element.getBoundingClientRect().top < window.innerHeight) return;
      element.classList.add('reveal-pending');
      revealObserver.observe(element);
    });
    document.addEventListener('focusin', event => {
      event.target.closest('.reveal-pending')?.classList.remove('reveal-pending');
    });
    reducedMotion.addEventListener('change', () => {
      if (reducedMotion.matches) {
        revealObserver.disconnect();
        document.querySelectorAll('.reveal-pending').forEach(element => element.classList.remove('reveal-pending'));
      }
    });
  }

  document.querySelectorAll('[data-tabs]').forEach(group => {
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
    if (!tabs.length || panels.some(panel => !panel)) return;
    const select = (index, moveFocus = false) => {
      tabs.forEach((tab, current) => {
        const active = current === index;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        panels[current].hidden = !active;
      });
      if (moveFocus) tabs[index].focus();
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(index));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next !== undefined) {
          event.preventDefault();
          select(next, true);
        }
      });
    });
    select(Math.max(0, tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true')));
    group.classList.add('tabs-ready');
    const revealLinkedPanel = () => {
      if (!location.hash) return;
      let target;
      try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { return; }
      const index = panels.findIndex(panel => panel === target || panel.contains(target));
      if (index >= 0) select(index);
    };
    window.addEventListener('hashchange', revealLinkedPanel);
    revealLinkedPanel();
  });

  document.querySelectorAll('[data-brief-builder]').forEach(form => {
    const output = document.querySelector('[data-brief-output]');
    const text = output?.querySelector('[data-brief-text]');
    const status = output?.querySelector('[data-brief-status]');
    const copy = output?.querySelector('[data-copy-brief]');
    if (!output || !text || !status || !copy) return;
    output.hidden = true;
    copy.disabled = true;
    const submit = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const get = name => String(data.get(name) || '').trim();
      if (!get('workflow')) {
        form.elements.namedItem('workflow').focus();
        return;
      }
      const lines = [
        'OURO NEX / PROJECT BRIEF',
        '',
        'Organization: ' + (get('organization') || 'Not specified'),
        'Area of interest: ' + (get('interest') || 'Not sure yet'),
        '',
        'WORKFLOW TO IMPROVE',
        get('workflow'),
        '',
        'WHAT SUCCESS WOULD LOOK LIKE',
        get('goal') || 'To be discussed during scoping.',
        '',
        'POINTS TO AGREE BEFORE A PILOT',
        '- Existing tools, information sources and data permissions',
        '- Professional review and acceptance criteria',
        '- A bounded workflow and a responsible team',
        '',
        'Prepared locally in this browser. Not submitted to OuroNex.'
      ];
      text.value = lines.join('\n');
      output.hidden = false;
      copy.disabled = false;
      status.textContent = 'Brief created on your device. Nothing has been sent.';
      text.focus({ preventScroll: true });
    });
    if (submit) submit.disabled = false;
    copy.addEventListener('click', async () => {
      if (!text.value) return;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text.value);
        status.textContent = 'Brief copied. You can paste it into your own notes or email.';
      } catch {
        text.focus();
        text.select();
        status.textContent = 'Automatic copy is unavailable. Your brief is selected; use your device’s copy command.';
      }
    });
  });
})();
