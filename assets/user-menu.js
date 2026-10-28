// OuroNex — user menu & account drawer
// Loads on every marketing page. When the user is signed in (sessionStorage.ouronex.accessToken),
// replaces the "Sign in" nav link with an avatar button that opens a side drawer with quick
// navigation to the dashboard, subscription, billing, settings, and sign-out.
//
// The app origin is resolved the same way assets/signin.js does — window.OUREX_APP_ORIGIN or
// http://localhost:3100 by default.
(function () {
  'use strict';

  var APP_ORIGIN = (window.OUREX_APP_ORIGIN || 'http://localhost:3100').replace(/\/+$/, '');
  var TOKEN_KEY = 'ouronex.accessToken';
  var EMAIL_KEY = 'ouronex.userEmail';
  var NAME_KEY = 'ouronex.userName';

  function getToken() {
    try {
      var t = window.sessionStorage.getItem(TOKEN_KEY);
      return t && t.trim() ? t.trim() : null;
    } catch (e) {
      return null;
    }
  }

  function getStoredEmail() {
    try { return window.sessionStorage.getItem(EMAIL_KEY) || ''; } catch (e) { return ''; }
  }

  function getStoredName() {
    try { return window.sessionStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }

  function initials(name, email) {
    var source = (name || email || 'U').trim();
    if (!source) return 'U';
    var parts = source.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return source.substring(0, 2).toUpperCase();
  }

  // Bail out early if the user is not signed in — the existing Sign in link stays.
  var token = getToken();
  if (!token) return;

  var signinLink = document.querySelector('a[data-signin]');
  if (!signinLink) return;

  // ---------- Build trigger button ----------
  var trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'oum-trigger';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'oum-drawer');
  trigger.setAttribute('aria-label', 'Open account menu');

  var name = getStoredName();
  var email = getStoredEmail();
  var display = name || email || 'Account';

  trigger.innerHTML =
    '<span class="oum-avatar" aria-hidden="true">' + initials(name, email) + '</span>' +
    '<span class="oum-trigger-label">' + escapeHtml(display) + '</span>' +
    '<span class="oum-caret" aria-hidden="true"></span>';

  // Replace the sign-in link inside the nav (kept for desktop layout),
  // AND mount a standalone copy on the nav shell so mobile users see it
  // even when .desktop-nav is collapsed behind the hamburger.
  var desktopTrigger = trigger;
  signinLink.parentNode.replaceChild(desktopTrigger, signinLink);

  var mobileTrigger = trigger.cloneNode(true);
  mobileTrigger.classList.add('oum-trigger--standalone');
  var navShell = document.querySelector('.nav-shell');
  var menuToggle = document.querySelector('.menu-toggle');
  if (navShell && menuToggle) {
    navShell.insertBefore(mobileTrigger, menuToggle);
  }

  // ---------- Build backdrop ----------
  var backdrop = document.createElement('div');
  backdrop.className = 'oum-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  // ---------- Build drawer ----------
  var drawer = document.createElement('aside');
  drawer.className = 'oum-drawer';
  drawer.id = 'oum-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Account menu');
  drawer.tabIndex = -1;

  drawer.innerHTML =
    '<div class="oum-drawer-head">' +
      '<span class="oum-drawer-title">Account</span>' +
      '<button type="button" class="oum-close" aria-label="Close account menu">' +
        '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<path d="M1 1l12 12M13 1L1 13"/>' +
        '</svg>' +
      '</button>' +
    '</div>' +
    '<div class="oum-profile">' +
      '<span class="oum-profile-avatar" aria-hidden="true">' + initials(name, email) + '</span>' +
      '<div>' +
        '<p class="oum-profile-name">' + escapeHtml(display) + '</p>' +
        (email ? '<p class="oum-profile-email">' + escapeHtml(email) + '</p>' : '') +
      '</div>' +
    '</div>' +
    '<div style="padding:16px 0 0">' +
      '<div class="oum-plan">' +
        '<div>' +
          '<div class="oum-plan-label">Current plan</div>' +
          '<div class="oum-plan-name" data-oum-plan>—</div>' +
        '</div>' +
        '<span class="oum-plan-pill" data-oum-status>…</span>' +
      '</div>' +
    '</div>' +
    '<nav class="oum-nav" aria-label="Account">' +
      '<a href="' + APP_ORIGIN + '/dashboard"><span>Overview</span><span class="oum-arrow" aria-hidden="true">→</span></a>' +
      '<a href="' + APP_ORIGIN + '/dashboard#subscription"><span>Subscription</span><span class="oum-arrow" aria-hidden="true">→</span></a>' +
      '<a href="' + APP_ORIGIN + '/dashboard#billing"><span>Billing history</span><span class="oum-arrow" aria-hidden="true">→</span></a>' +
      '<a href="' + APP_ORIGIN + '/dashboard#settings"><span>Settings</span><span class="oum-arrow" aria-hidden="true">→</span></a>' +
      '<a href="' + location.origin + '/pricing.html"><span>View plans</span><span class="oum-nav-note">Free · Basic · Pro</span></a>' +
    '</nav>' +
    '<div class="oum-foot">' +
      '<a class="oum-btn oum-btn-primary" href="' + APP_ORIGIN + '/dashboard">Open dashboard</a>' +
      '<button type="button" class="oum-btn oum-btn-outline" data-oum-signout>Sign out</button>' +
    '</div>';

  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);

  // ---------- Wire behaviour ----------
  var closeBtn = drawer.querySelector('.oum-close');
  var signoutBtn = drawer.querySelector('[data-oum-signout]');
  var lastFocus = null;

  function openDrawer() {
    lastFocus = document.activeElement;
    drawer.classList.add('is-open');
    backdrop.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    drawer.focus();
  }

  function closeDrawer() {
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  trigger.addEventListener('click', function () {
    if (drawer.classList.contains('is-open')) closeDrawer(); else openDrawer();
  });
  mobileTrigger.addEventListener('click', function () {
    if (drawer.classList.contains('is-open')) closeDrawer(); else openDrawer();
  });
  closeBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && drawer.classList.contains('is-open')) {
      closeDrawer();
    }
  });

  signoutBtn.addEventListener('click', function () {
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(EMAIL_KEY);
      window.sessionStorage.removeItem(NAME_KEY);
    } catch (e) {}
    // The app origin also holds a copy of the token; sign out there too so both are cleared.
    window.location.href = APP_ORIGIN + '/login.html?signout=1';
  });

  // ---------- Fetch plan + status for the drawer ----------
  fetch(APP_ORIGIN + '/api/account/me/subscription', {
    headers: { authorization: 'Bearer ' + token, accept: 'application/json' }
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      var planEl = drawer.querySelector('[data-oum-plan]');
      var statusEl = drawer.querySelector('[data-oum-status]');
      if (data.email && !email) {
        try { window.sessionStorage.setItem(EMAIL_KEY, data.email); } catch (e) {}
        var emailEl = drawer.querySelector('.oum-profile-email');
        if (!emailEl) {
          emailEl = document.createElement('p');
          emailEl.className = 'oum-profile-email';
          drawer.querySelector('.oum-profile > div').appendChild(emailEl);
        }
        emailEl.textContent = data.email;
        // Also update the trigger label if it was the placeholder
        if (!name) {
          var labelEl = trigger.querySelector('.oum-trigger-label');
          if (labelEl) labelEl.textContent = data.email;
        }
      }
      if (data.planId && planEl) {
        planEl.textContent = String(data.planId).charAt(0).toUpperCase() + String(data.planId).slice(1);
      } else if (planEl) {
        planEl.textContent = 'Free';
      }
      if (statusEl) {
        statusEl.textContent = data.status || 'inactive';
      }
    })
    .catch(function () {
      var statusEl = drawer.querySelector('[data-oum-status]');
      if (statusEl) statusEl.textContent = 'offline';
    });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
