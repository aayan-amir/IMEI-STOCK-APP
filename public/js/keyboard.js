/* Keyboard visibility follows the visual viewport; no native keyboard plugin is required. */

(function initKeyboardHandler() {
  // Only run on Capacitor / mobile webview
  if (!window.visualViewport) return;

  var vv = window.visualViewport;
  var root = document.documentElement;
  var lastKeyboardHeight = 0;

  function onViewportResize() {
    // The difference between the layout viewport (window.innerHeight)
    // and the visual viewport height tells us how tall the keyboard is.
    var keyboardHeight = Math.max(0, Math.round(window.innerHeight - vv.height));

    // Avoid unnecessary style recalcs
    if (keyboardHeight === lastKeyboardHeight) return;
    lastKeyboardHeight = keyboardHeight;

    root.style.setProperty('--keyboard-height', keyboardHeight + 'px');

    // If keyboard just opened, scroll the active element into view
    if (keyboardHeight > 0) {
      requestAnimationFrame(function() {
        var el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
          // Find the nearest scrollable container
          var scrollable = el.closest('.stock-scroll, .hq-body, .monthly-scroll, #auth-overlay, #stock-wrap');
          if (scrollable) {
            var elRect = el.getBoundingClientRect();
            var scrollRect = scrollable.getBoundingClientRect();
            // If the element is below the visible area of its scroll container
            if (elRect.bottom > scrollRect.bottom - 10) {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          } else {
            // Fallback: just scroll into view
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
      });
    }
  }

  vv.addEventListener('resize', onViewportResize);
  // Also listen for scroll events on the visual viewport (some devices
  // fire scroll instead of resize when the viewport shifts up)
  vv.addEventListener('scroll', onViewportResize);

  // Reset keyboard height when focus leaves input fields
  document.addEventListener('focusout', function() {
    // Small delay to allow focus to move to another input
    setTimeout(function() {
      var el = document.activeElement;
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT')) {
        root.style.setProperty('--keyboard-height', '0px');
        lastKeyboardHeight = 0;
      }
    }, 100);
  });
})();
