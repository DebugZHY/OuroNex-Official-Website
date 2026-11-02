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

  const homeScroll = document.querySelector('main#main.home-scroll');
  const progress = document.querySelector('.reading-progress');
  let scrollFrame = 0;
  const updateScroll = () => {
    scrollFrame = 0;
    const scrollTop = homeScroll ? homeScroll.scrollTop : window.scrollY;
    // Home owns its one-page header state; the container supplies the reading position.
    if (!homeScroll) header?.classList.toggle('is-scrolled', window.scrollY > 24);
    const distance = homeScroll
      ? homeScroll.scrollHeight - homeScroll.clientHeight
      : root.scrollHeight - window.innerHeight;
    const value = distance > 0 ? Math.min(1, Math.max(0, scrollTop / distance)) : 0;
    if (progress) progress.style.transform = `scaleX(${value})`;
  };
  const queueScroll = () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
  };
  window.addEventListener('scroll', queueScroll, { passive: true });
  homeScroll?.addEventListener('scroll', queueScroll, { passive: true });
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

  const safeAvatarUrl = value => {
    if (typeof value !== 'string') return '';
    const raw = value.trim();
    if (!raw) return '';
    let url;
    try {
      url = new URL(raw, document.baseURI || window.location.href);
    } catch {
      return '';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.hostname ? url.href : '';
  };
  const initialsFromUsername = value => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) return '';
    const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[\s._\-@+]+/g, ' ').trim();
    const words = spaced.split(/\s+/).filter(Boolean);
    const lettersOnly = word => Array.from(word).filter(character => /[\p{L}\p{N}]/u.test(character));
    let characters = [];
    if (words.length > 1) {
      const first = lettersOnly(words[0])[0];
      const second = lettersOnly(words[1])[0];
      if (first && second) characters = [first, second];
      else if (first) characters = lettersOnly(words[0]);
    } else if (words.length === 1) {
      characters = lettersOnly(words[0]);
    }
    if (!characters.length) characters = Array.from(name.replace(/[\s._\-@+]+/g, '')).filter(Boolean);
    if (!characters.length) return '??';
    const combined = (characters[0] + (characters[1] || characters[0])).toUpperCase();
    const upper = Array.from(combined);
    if (upper.length === 1) return upper[0] + upper[0];
    return upper.slice(0, 2).join('');
  };
  const styleInitials = node => {
    node.style.display = 'inline-flex';
    node.style.alignItems = 'center';
    node.style.justifyContent = 'center';
    node.style.width = '28px';
    node.style.height = '28px';
    node.style.flex = 'none';
    node.style.borderRadius = '50%';
    node.style.background = 'rgba(114, 158, 255, .18)';
    node.style.border = '1px solid rgba(114, 158, 255, .5)';
    node.style.color = 'var(--ink, #edf2f8)';
    node.style.fontSize = '11px';
    node.style.fontWeight = '600';
    node.style.lineHeight = '1';
    node.style.letterSpacing = '.02em';
  };
  const makeInitials = username => {
    const node = document.createElement('span');
    node.className = 'nav-initials';
    node.dataset.userInput = '';
    node.setAttribute('aria-hidden', 'true');
    node.textContent = initialsFromUsername(username);
    styleInitials(node);
    return node;
  };
  const styleAvatar = image => {
    image.style.display = 'block';
    image.style.width = '28px';
    image.style.height = '28px';
    image.style.flex = 'none';
    image.style.borderRadius = '50%';
    image.style.objectFit = 'cover';
    image.style.background = 'rgba(114, 158, 255, .18)';
  };
  const setSignedIn = (link, user) => {
    const username = typeof user.username === 'string' ? user.username.trim() : '';
    if (!username) return;
    /* A signed-in visitor sees an avatar instead of Log in / Register. */
    document.querySelectorAll('[data-register]').forEach(node => node.remove());
    const avatar = safeAvatarUrl(user.avatar);
    link.setAttribute('href', '/dashboard/');
    link.classList.add('is-authenticated');
    link.removeAttribute('data-i18n');
    link.removeAttribute('data-i18n-dynamic');
    delete link.dataset.i18nDynamicKey;
    link.removeAttribute('data-i18n-aria-label');
    link.removeAttribute('data-i18n-title');
    link.setAttribute('aria-label', username);
    link.setAttribute('title', username);

    if (avatar) {
      const image = document.createElement('img');
      image.className = 'nav-avatar';
      image.alt = '';
      image.width = 28;
      image.height = 28;
      image.decoding = 'async';
      image.dataset.userInput = '';
      styleAvatar(image);
      image.addEventListener('error', () => {
        link.replaceChildren(makeInitials(username));
      }, { once: true });
      link.replaceChildren(image);
      image.src = avatar;
      return;
    }
    link.replaceChildren(makeInitials(username));
  };
  const loadSignedInUser = () => {
    const links = [...document.querySelectorAll('[data-signin]')];
    if (!links.length || typeof fetch !== 'function') return;
    fetch('/api/v1/auth/me/', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    }).then(response => {
      if (!response || !response.ok) return null;
      return response.json().then(body => body, () => null);
    }).then(payload => {
      if (!payload || !payload.user || typeof payload.user !== 'object') return;
      links.forEach(link => setSignedIn(link, payload.user));
    }).catch(() => {
      /* Anonymous and offline visitors keep the normal Log in destination. */
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadSignedInUser, { once: true });
  else loadSignedInUser();

  /* The header Log in / Register pills carry a pointer-following light, the same
     hover the hero CTAs use. site.css owns the look; this only writes --mx/--my. */
  const glowPills = [...document.querySelectorAll('.nav-secondary [data-signin]:not(.is-authenticated), .nav-secondary [data-register]')];
  glowPills.forEach(pill => {
    let frame = 0;
    const paint = event => {
      frame = 0;
      const rect = pill.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
      const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
      pill.style.setProperty('--mx', `${x.toFixed(2)}%`);
      pill.style.setProperty('--my', `${y.toFixed(2)}%`);
    };
    const track = event => {
      if (frame || event.pointerType === 'touch' || reducedMotion.matches) return;
      frame = requestAnimationFrame(() => paint(event));
    };
    pill.addEventListener('pointermove', track);
    pill.addEventListener('pointerleave', () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pill.style.setProperty('--mx', '50%');
      pill.style.setProperty('--my', '50%');
    });
  });
})();
