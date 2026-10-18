function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

/* ── Trạng thái sẵn sàng của auth ──────────────────────────────────────────
 * initAuth() là async, còn các trang (deals.html) lại render dữ liệu ngay.
 * Nếu không chờ, currentUser có thể vẫn là null khi user đã đăng nhập →
 * click "Mua ngay" sẽ mở nhầm modal đăng nhập.
 * waitForAuth() cho phép trang chờ auth xong (có timeout để không treo UI).
 * ------------------------------------------------------------------------ */
let authReady = false;
let resolveAuthReady = null;
const authReadyPromise = new Promise((resolve) => { resolveAuthReady = resolve; });

function markAuthReady() {
  if (authReady) return;
  authReady = true;
  if (resolveAuthReady) resolveAuthReady();
}

async function waitForAuth(timeoutMs = 4000) {
  if (authReady) return;
  await Promise.race([
    authReadyPromise,
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

async function initAuth() {
  const warning = document.getElementById('configWarning');
  const loginBtn = document.getElementById('loginBtn');
  const convertBtn = document.getElementById('convertBtn');

  try {
    // Bắt referral code từ URL
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    if (refCode) {
      localStorage.setItem('referralCode', refCode);
    }

    if (!supabaseClient) {
      if (warning) {
        warning.classList.add('show');
        warning.textContent = SUPABASE_READY
          ? 'Không tải được Supabase SDK. Hãy kiểm tra kết nối CDN hoặc self-host SDK.'
          : 'Chưa cấu hình Supabase. Hãy thay SUPABASE_URL và SUPABASE_ANON_KEY trong file HTML sau khi tạo project.';
      }
      if (loginBtn) loginBtn.disabled = true;
      if (convertBtn) convertBtn.disabled = true;
      return;
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    setCurrentUser(session?.user || null);

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user || null);
    });
  } finally {
    // Luôn mở khoá để trang không phải chờ đủ timeout
    markAuthReady();
  }
}

function setCurrentUser(user) {
  const previousUser = currentUser;
  currentUser = user;
  updateAuthUi();
  updateHeaderUser();
  if (typeof updatePayoutUi === 'function') updatePayoutUi();
  if (typeof updateDrawerUser === 'function') updateDrawerUser();
  
  if (currentUser) {
    if (typeof loadLinkHistory === 'function') loadLinkHistory();
    if (typeof loadPayoutProfile === 'function') loadPayoutProfile();

    
    if (typeof loadReferralStats === 'function') {
      loadReferralStats();
    }

    // Nếu vừa login thành công (trước đó là null, giờ có user)
    if (!previousUser) {
      applyPendingReferral();
    }
  } else {
    // deals.html không load history.js/payout.js → phải guard để không ReferenceError
    if (typeof renderHistory === 'function') renderHistory([]);
    if (typeof resetPayoutForm === 'function') resetPayoutForm();
  }
}

async function applyPendingReferral() {
  const refCode = localStorage.getItem('referralCode');
  if (!refCode || !supabaseClient) return;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const response = await fetch(`${SUPABASE_URL}/functions/v1/apply-referral`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ referral_code: refCode })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Applied referral successfully:', data);
      localStorage.removeItem('referralCode');
    } else {
      const err = await response.json();
      console.warn('Failed to apply referral:', err);
      // Xóa luôn để không thử lại mãi nếu lỗi (VD: không phải user mới)
      localStorage.removeItem('referralCode');
    }
  } catch (error) {
    console.error('Error applying referral:', error);
  }
}

function updateAuthUi() {
  const authPanel = document.querySelector('.auth-panel');
  const refAuthPanel = document.getElementById('refAuthPanel');
  const authTitle = document.getElementById('authTitle');
  const authStatus = document.getElementById('authStatus');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const refLoginBtn = document.getElementById('refLoginBtn');
  const refLogoutBtn = document.getElementById('refLogoutBtn');
  const footerLogoutBtn = document.getElementById('footerLogoutBtn');

  if (currentUser) {
    if (authPanel) authPanel.style.display = 'none';
    if (refAuthPanel) refAuthPanel.style.display = 'none';
    if (footerLogoutBtn) footerLogoutBtn.style.display = 'inline-block';
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    if (refLoginBtn) refLoginBtn.style.display = 'none';
    if (refLogoutBtn) refLogoutBtn.style.display = 'inline-flex';
    return;
  }

  if (authPanel) authPanel.style.display = 'flex';
  if (refAuthPanel) refAuthPanel.style.display = 'block';
  if (footerLogoutBtn) footerLogoutBtn.style.display = 'none';

  if (authTitle) authTitle.textContent = 'Đăng nhập để nhận hoàn tiền';
  if (authStatus) authStatus.textContent = 'Mỗi link sẽ được gắn mã tracking riêng theo tài khoản của bạn.';
  if (loginBtn) loginBtn.style.display = 'inline-flex';
  if (logoutBtn) logoutBtn.style.display = 'none';
  if (refLoginBtn) refLoginBtn.style.display = 'inline-flex';
  if (refLogoutBtn) refLogoutBtn.style.display = 'none';
}


async function signInWithGoogle() {
  if (!supabaseClient) return;

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: getAuthRedirectUrl()
    }
  });

  if (error) showError('Không đăng nhập được Google. Vui lòng kiểm tra cấu hình Supabase Auth.');
}

async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  window.location.reload();
}

function updateHeaderUser() {
  const loginBtn = document.getElementById('headerLoginBtn');
  const userPill = document.getElementById('headerUserPill');
  const avatar = document.getElementById('headerUserAvatar');
  const nameEl = document.getElementById('headerUserName');
  const dropdownAvatar = document.getElementById('headerDropdownAvatar');
  const dropdownName = document.getElementById('headerDropdownName');
  const dropdownEmail = document.getElementById('headerDropdownEmail');
  const adminLink = document.getElementById('headerAdminLink');

  if (currentUser) {
    const meta = currentUser.user_metadata || {};
    const name = meta.full_name || meta.name || (currentUser.email ? currentUser.email.split('@')[0] : 'Người dùng');
    const email = currentUser.email || '';
    const pic = meta.avatar_url || meta.picture || 'assets/images/logo.png';

    if (avatar) avatar.src = pic;
    if (dropdownAvatar) dropdownAvatar.src = pic;
    if (nameEl) nameEl.textContent = name;
    if (dropdownName) dropdownName.textContent = name;
    if (dropdownEmail) dropdownEmail.textContent = email;

    if (adminLink) {
      const isAdmin = email.toLowerCase() === 'nducthien96@gmail.com';
      adminLink.style.display = isAdmin ? 'flex' : 'none';
    }

    if (loginBtn) loginBtn.style.display = 'none';
    if (userPill) userPill.style.display = 'inline-flex';
  } else {
    if (loginBtn) loginBtn.style.display = 'inline-flex';
    if (userPill) userPill.style.display = 'none';
    const menu = document.getElementById('headerUserDropdown');
    if (menu) menu.classList.remove('show');
    const pill = document.getElementById('headerUserPill');
    if (pill) {
      pill.classList.remove('open');
      pill.setAttribute('aria-expanded', 'false');
    }
  }
}

function toggleHeaderUserMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('headerUserDropdown');
  const pill = document.getElementById('headerUserPill');
  if (!menu) return;

  const isOpen = menu.classList.toggle('show');
  if (pill) {
    pill.classList.toggle('open', isOpen);
    pill.setAttribute('aria-expanded', String(isOpen));
  }
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('headerUserDropdown');
  const pill = document.getElementById('headerUserPill');
  if (menu && menu.classList.contains('show')) {
    if (pill && !pill.contains(e.target)) {
      menu.classList.remove('show');
      pill.classList.remove('open');
      pill.setAttribute('aria-expanded', 'false');
    }
  }
});

