function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}
async function initAuth() {
  const warning = document.getElementById('configWarning');
  const loginBtn = document.getElementById('loginBtn');
  const convertBtn = document.getElementById('convertBtn');

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
  currentUser = user;
  updateAuthUi();
  updatePayoutUi();
  if (currentUser) {
    grantSignupBonusIfNeeded().then(() => {
      loadLinkHistory();
      loadPayoutProfile();
    });
  } else {
    renderHistory([]);
    resetPayoutForm();
  }
}

/**
 * Kiểm tra và cấp bonus 20.000đ cho user mới đăng nhập lần đầu.
 * - Nếu profile chưa có signup_bonus_credited = true → upsert với bonus_balance = 20000
 * - Dùng upsert an toàn: chỉ set bonus khi chưa được credited (tránh reset)
 */
async function grantSignupBonusIfNeeded() {
  if (!supabaseClient || !currentUser) return;

  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('signup_bonus_credited, bonus_balance')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (error) {
      console.error('grantSignupBonusIfNeeded: cannot fetch profile', error);
      return;
    }

    // Nếu đã credited rồi → bỏ qua
    if (data?.signup_bonus_credited) return;

    // Chưa có bonus → credit ngay
    const { error: upsertError } = await supabaseClient
      .from('profiles')
      .upsert({
        id: currentUser.id,
        email: currentUser.email,
        full_name: currentUser.user_metadata?.full_name || null,
        avatar_url: currentUser.user_metadata?.avatar_url || null,
        bonus_balance: 20000,
        signup_bonus_credited: true
      }, { onConflict: 'id' });

    if (upsertError) {
      console.error('grantSignupBonusIfNeeded: upsert failed', upsertError);
    } else {
      console.log('✅ Đã cấp bonus 20.000đ cho user mới:', currentUser.email);
    }
  } catch (err) {
    console.error('grantSignupBonusIfNeeded error:', err);
  }
}

function updateAuthUi() {
  const authPanel = document.querySelector('.auth-panel');
  const authTitle = document.getElementById('authTitle');
  const authStatus = document.getElementById('authStatus');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const footerLogoutBtn = document.getElementById('footerLogoutBtn');

  if (currentUser) {
    if (authPanel) authPanel.style.display = 'none';
    if (footerLogoutBtn) footerLogoutBtn.style.display = 'inline-block';
    return;
  }

  if (authPanel) authPanel.style.display = 'flex';
  if (footerLogoutBtn) footerLogoutBtn.style.display = 'none';

  authTitle.textContent = 'Đăng nhập để nhận hoàn tiền';
  authStatus.textContent = 'Mỗi link sẽ được gắn mã tracking riêng theo tài khoản của bạn.';
  loginBtn.style.display = 'inline-flex';
  logoutBtn.style.display = 'none';
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
