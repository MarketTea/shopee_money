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
    loadLinkHistory();
    loadPayoutProfile();
  } else {
    renderHistory([]);
    resetPayoutForm();
  }
}

function updateAuthUi() {
  const authTitle = document.getElementById('authTitle');
  const authStatus = document.getElementById('authStatus');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if (currentUser) {
    const displayName = currentUser.user_metadata?.full_name || currentUser.email || 'Tài khoản Google';
    authTitle.textContent = `Xin chào, ${displayName}`;
    authStatus.textContent = 'Bạn đã sẵn sàng tạo link có tracking để đối soát hoa hồng.';
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-flex';
    return;
  }

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
