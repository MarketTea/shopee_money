const shopeeLinkEl = document.getElementById('shopeeLink');
if (shopeeLinkEl) {
  shopeeLinkEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') convertLink();
  });
}

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
  if (typeof initReferralCode === 'function') initReferralCode();
  if (typeof initAuth === 'function') initAuth();
  if (typeof initStepper === 'function') initStepper();

  // Check URL query parameters for tab navigation (e.g. index.html?tab=payout)
  const urlParams = new URLSearchParams(window.location.search);
  const tabParam = urlParams.get('tab');
  if (tabParam) {
    switchConverterTab(tabParam);
  }
});

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  if (typeof initReferralCode === 'function') initReferralCode();
  if (typeof initAuth === 'function') initAuth();
  if (typeof initStepper === 'function') initStepper();
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

/* ── MOBILE DRAWER ── */
function updateDrawerUser() {
  const userPill = document.getElementById('drawerUserCard');
  const loginPill = document.getElementById('drawerLoginCard');
  const avatar = document.getElementById('drawerUserAvatar');
  const nameEl = document.getElementById('drawerUserName');
  const emailEl = document.getElementById('drawerUserEmail');

  if (!userPill) return;

  if (currentUser) {
    const meta = currentUser.user_metadata || {};
    const name = meta.full_name || meta.name || 'Người dùng';
    const email = currentUser.email || '';
    const pic = meta.avatar_url || meta.picture || 'assets/images/logo.png';

    if (avatar) avatar.src = pic;
    if (nameEl) nameEl.textContent = name;
    if (emailEl) emailEl.textContent = email;

    userPill.classList.add('is-logged-in');
    if (loginPill) loginPill.classList.add('is-hidden');
  } else {
    userPill.classList.remove('is-logged-in');
    if (loginPill) loginPill.classList.remove('is-hidden');
  }
}

function toggleUserMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('drawerUserDropdown');
  if (menu) {
    menu.classList.toggle('show');
  }
}

// Close user dropdown when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('drawerUserDropdown');
  const pill = document.getElementById('drawerUserCard');
  if (menu && menu.classList.contains('show')) {
    if (pill && !pill.contains(e.target)) {
      menu.classList.remove('show');
    }
  }
});

function openDrawer() {
  const drawer = document.getElementById('mobileDrawer');
  const overlay = document.getElementById('drawerOverlay');
  const btn = document.getElementById('hamburgerBtn');
  if (!drawer) return;
  updateDrawerUser();
  drawer.classList.add('is-open');
  if (overlay) overlay.classList.add('is-open');
  if (btn) btn.classList.add('is-open');
  document.documentElement.style.overflow = 'hidden';
}

function closeDrawer() {
  const drawer = document.getElementById('mobileDrawer');
  const overlay = document.getElementById('drawerOverlay');
  const btn = document.getElementById('hamburgerBtn');
  if (!drawer) return;
  drawer.classList.remove('is-open');
  if (overlay) overlay.classList.remove('is-open');
  if (btn) btn.classList.remove('is-open');
  document.documentElement.style.overflow = '';
}

// Close drawer on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

// Highlight active drawer link based on current page
(function markActiveDrawerLink() {
  const links = document.querySelectorAll('.drawer-nav a');
  const current = window.location.pathname.split('/').pop() || 'index.html';
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href && href !== 'javascript:void(0)' && current === href) {
      link.classList.add('active');
    }
  });
})();

