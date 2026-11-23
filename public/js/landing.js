(() => {
  const form = document.getElementById('sales-form');
  if (!form) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const value = id => document.getElementById(id).value.trim();
    const subject = 'Stock-ly sales enquiry — ' + value('sales-shop');
    const body = `Name: ${value('sales-name')}\nBusiness: ${value('sales-shop')}\nEmail: ${value('sales-email')}\nShops: ${value('sales-count')}\n\n${value('sales-message')}`;
    window.location.href = 'mailto:ayanwork1@gmail.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    document.getElementById('sales-status').textContent = 'Continue in your email app to send. If it did not open, email ayanwork1@gmail.com directly.';
  });

  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  const surfaces = [...document.querySelectorAll('.hero-visual, .feature-card, .button, .contact-form')];
  let frame = 0;
  let pending = null;
  function reset(surface) {
    surface.style.removeProperty('--pointer-x');
    surface.style.removeProperty('--pointer-y');
    surface.style.removeProperty('--tilt-x');
    surface.style.removeProperty('--tilt-y');
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; pending = null;
    surfaces.forEach(reset);
    document.querySelectorAll('.reveal').forEach(node => node.classList.add('revealed'));
  }
  if (!motion?.matches && finePointer?.matches) {
    for (const surface of surfaces) {
      surface.addEventListener('pointermove', event => {
        if (motion.matches || event.pointerType === 'touch') return;
        pending = { surface, x: event.clientX, y: event.clientY };
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!pending) return;
          const { surface, x, y } = pending;
          const bounds = surface.getBoundingClientRect();
          const px = Math.max(0, Math.min(1, (x - bounds.left) / bounds.width));
          const py = Math.max(0, Math.min(1, (y - bounds.top) / bounds.height));
          surface.style.setProperty('--pointer-x', `${px * 100}%`);
          surface.style.setProperty('--pointer-y', `${py * 100}%`);
          if (surface.classList.contains('hero-visual')) {
            surface.style.setProperty('--tilt-x', `${(0.5 - py) * 5}deg`);
            surface.style.setProperty('--tilt-y', `${(px - 0.5) * 5}deg`);
          }
          pending = null;
        });
      }, { passive: true });
      surface.addEventListener('pointerleave', () => {
        if (pending?.surface === surface) pending = null;
        reset(surface);
      });
    }
  }
  if (!motion?.matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08 });
    document.querySelectorAll('.section-heading, .feature-card, .care-grid, .steps li, .faq-section, .contact-grid').forEach(node => {
      node.classList.add('reveal'); observer.observe(node);
    });
    motion?.addEventListener('change', () => { if (motion.matches) { observer.disconnect(); stop(); } });
  }
  window.addEventListener('pagehide', stop);
})();
