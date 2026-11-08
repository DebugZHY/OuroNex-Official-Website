(function () {
  var PASSCODE = 'sida123456';
  var RESET_MS = 10000;
  var gate = document.getElementById('site-gate');
  if (!gate) return;

  var buffer = '';
  var resetTimer = 0;
  var unlocked = false;
  var lockedSiblings = [];

  Array.prototype.forEach.call(document.body.children, function (node) {
    if (node === gate) return;
    lockedSiblings.push({
      node: node,
      inert: node.hasAttribute('inert'),
      ariaHidden: node.getAttribute('aria-hidden')
    });
    node.setAttribute('inert', '');
    node.setAttribute('aria-hidden', 'true');
  });

  function reset() {
    buffer = '';
  }

  function openSite() {
    if (unlocked) return;
    unlocked = true;
    window.clearInterval(resetTimer);
    window.removeEventListener('keydown', onKeyDown, true);
    document.documentElement.classList.remove('gate-locked');
    document.body.classList.remove('gate-locked');
    lockedSiblings.forEach(function (item) {
      if (!item.inert) item.node.removeAttribute('inert');
      if (item.ariaHidden === null) item.node.removeAttribute('aria-hidden');
      else item.node.setAttribute('aria-hidden', item.ariaHidden);
    });
    gate.parentNode.removeChild(gate);
    if (window.location.hash !== '#home') {
      try {
        window.history.replaceState(null, '', '#home');
      } catch (error) {
        window.location.hash = 'home';
      }
    }
    window.scrollTo(0, 0);
  }

  function onKeyDown(event) {
    if (unlocked || event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (buffer === PASSCODE) {
        openSite();
      } else {
        buffer = '';
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1 || !/[a-z0-9]/i.test(event.key)) return;
    event.preventDefault();
    buffer += event.key.toLowerCase();
  }

  document.body.classList.add('gate-locked');
  window.addEventListener('keydown', onKeyDown, true);
  resetTimer = window.setInterval(reset, RESET_MS);
  if (typeof gate.focus === 'function') gate.focus();
})();
