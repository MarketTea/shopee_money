function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}
async function initAuth() {
  const warning = document.getElementById('configWarning');
  const loginBtn = document.getElementById('loginBtn');
  const convertBtn = document.getElementById('convertBtn');

  // Bắt referral code từ URL
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  if (refCode) {
    localStorage.setItem('referralCode', refCode);
  }

  if (!supabaseClient) {
    warning.classList.add('show');
    warning.textContent = SUPABASE_READY
      ? 'Không tải được Supabase SDK. Hãy kiểm tra kết nối CDN hoặc self-host SDK.'
      : 'Chưa cấu hình Supabase. Hãy thay SUPABASE_URL và SUPABASE_ANON_KEY trong file HTML sau khi tạo project.';
    loginBtn.disabled = true;
    convertBtn.disabled = true;
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  setCurrentUser(session?.user || null);

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    setCurrentUser(session?.user || null);
  });
}

function setCurrentUser(user) {
  const previousUser = currentUser;
  currentUser = user;
  updateAuthUi();
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
    renderHistory([]);
    resetPayoutForm();
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
}
