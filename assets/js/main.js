document.getElementById('shopeeLink').addEventListener('keydown', e => {
  if (e.key === 'Enter') convertLink();
});

/* ── SCROLL REVEAL ── */
const revealEls = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      setTimeout(() => e.target.classList.add('visible'), i * 75);
      revealObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.1 });
revealEls.forEach(el => revealObserver.observe(el));
document.addEventListener('DOMContentLoaded', () => {
  initReferralCode();
  initAuth();
});
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initReferralCode();
  initAuth();
}
