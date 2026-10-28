// Sign-in entry point for the static marketing pages.
// The marketing pages are served statically and the account app lives on its own origin, so the
// address of the login page is resolved in exactly one place. Set window.OUREX_APP_ORIGIN before
// this script loads to point the link at a deployed app; without it the local app server is used.
(function () {
  'use strict';

  var origin = (window.OUREX_APP_ORIGIN || 'http://localhost:3100').replace(/\/+$/, '');
  var target = origin + '/login.html';
  var links = document.querySelectorAll('a[data-signin]');

  for (var i = 0; i < links.length; i += 1) {
    links[i].setAttribute('href', target);
  }
})();
