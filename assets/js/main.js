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
  initStepper();
});
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initReferralCode();
  initAuth();
  initStepper();
}

function switchConverterTab(tabName) {
  const tabBtnConvert = document.getElementById('tabBtnConvert');
  const tabBtnHistory = document.getElementById('tabBtnHistory');
  const tabBtnPayout = document.getElementById('tabBtnPayout');
  const tabContentConvert = document.getElementById('tabContentConvert');
  const tabContentHistory = document.getElementById('tabContentHistory');
  const tabContentPayout = document.getElementById('tabContentPayout');

  if (!tabBtnConvert || !tabBtnHistory || !tabBtnPayout || !tabContentConvert || !tabContentHistory || !tabContentPayout) return;

  // Reset active classes
  tabBtnConvert.classList.remove('active');
  tabBtnHistory.classList.remove('active');
  tabBtnPayout.classList.remove('active');
  tabContentConvert.classList.remove('active');
  tabContentHistory.classList.remove('active');
  tabContentPayout.classList.remove('active');

  if (tabName === 'convert') {
    tabBtnConvert.classList.add('active');
    tabContentConvert.classList.add('active');
  } else if (tabName === 'history') {
    tabBtnHistory.classList.add('active');
    tabContentHistory.classList.add('active');

    // Automatically load history when clicking the tab if user is logged in
    if (typeof loadLinkHistory === 'function' && currentUser) {
      loadLinkHistory();
    }
  } else if (tabName === 'payout') {
    tabBtnPayout.classList.add('active');
    tabContentPayout.classList.add('active');

    // Automatically load payout profile when clicking the tab if user is logged in
    if (typeof loadPayoutProfile === 'function' && currentUser) {
      loadPayoutProfile();
    }
  }
}

function navigateToTab(tabName) {
  const target = document.getElementById('convert');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth' });
  }
  switchConverterTab(tabName);
}

/* ── STEPPER ANIMATION ── */
function initStepper() {
  const steps = document.querySelectorAll('.stepper-step');
  const connectors = document.querySelectorAll('.stepper-connector');
  if (!steps.length) return;

  let currentStep = 0;
  const STEP_DURATION = 2500; // ms per step

  function goToStep(index) {
    steps.forEach((step, i) => {
      step.classList.remove('active', 'completed');
      if (i < index) step.classList.add('completed');
      if (i === index) step.classList.add('active');
    });
    connectors.forEach((conn, i) => {
      const fill = conn.querySelector('.stepper-connector-fill');
      if (fill) fill.style.width = i < index ? '100%' : '0%';
    });
    // Animate current connector filling
    if (index > 0 && connectors[index - 1]) {
      const fill = connectors[index - 1].querySelector('.stepper-connector-fill');
      if (fill) { fill.style.width = '0%'; requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = '100%'; })); }
    }
  }

  goToStep(0);
  setInterval(() => {
    currentStep = (currentStep + 1) % steps.length;
    goToStep(currentStep);
  }, STEP_DURATION);
}

