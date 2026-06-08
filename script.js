/* ── CONFIG ── */
const SUPABASE_URL = 'https://zgdnjlqqgxfpeizaawat.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnZG5qbHFxZ3hmcGVpemFhd2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDc5NTMsImV4cCI6MjA5NTk4Mzk1M30.tMNEc82u8lxpBY3zkan5uH5G3WeETQVwuqLWHfhtpWw';
const SUPABASE_READY = SUPABASE_URL.startsWith('https://') &&
  !SUPABASE_URL.includes('YOUR_PROJECT_REF') &&
  !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY');
const supabaseClient = SUPABASE_READY && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
let currentUser = null;
let currentAffiliateLinkId = null;

// Cấu hình mã giới thiệu động (tự động thay đổi theo ngày)
const REFERRAL_CONFIG = {
  defaultCode: '4TVCRM7',

  // Danh sách mã xoay vòng theo thứ trong tuần (0: Chủ Nhật, 1: Thứ 2, ..., 6: Thứ 7)
  weeklyCodes: [
    '4TVCRM7',
  ],

  // Mã đặc biệt dành riêng cho các ngày Siêu Sale lớn (Định dạng: YYYY-MM-DD)
  specialDates: {
    '2026-06-06': 'MEGA_66_SALE',
    '2026-07-07': 'MEGA_77_SALE',
    '2026-08-08': 'MEGA_88_SALE',
    '2026-09-09': 'MEGA_99_SALE',
    '2026-10-10': 'MEGA_1010_SALE',
    '2026-11-11': 'MEGA_1111_SALE',
    '2026-12-12': 'MEGA_1212_SALE'
  }
};

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
  if (currentUser) {
    loadLinkHistory();
  } else {
    renderHistory([]);
  }
}

function updateAuthUi() {
  const authTitle = document.getElementById('authTitle');
  const authStatus = document.getElementById('authStatus');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const historyPanel = document.getElementById('historyPanel');

  if (currentUser) {
    const displayName = currentUser.user_metadata?.full_name || currentUser.email || 'Tài khoản Google';
    authTitle.textContent = `Xin chào, ${displayName}`;
    authStatus.textContent = 'Bạn đã sẵn sàng tạo link có tracking để đối soát hoa hồng.';
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-flex';
    historyPanel.classList.add('show');
    return;
  }

  authTitle.textContent = 'Đăng nhập để nhận hoàn tiền';
  authStatus.textContent = 'Mỗi link sẽ được gắn mã tracking riêng theo tài khoản của bạn.';
  loginBtn.style.display = 'inline-flex';
  logoutBtn.style.display = 'none';
  historyPanel.classList.remove('show');
}

async function signInWithGoogle() {
  if (!supabaseClient) return;

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.href.split('#')[0]
    }
  });

  if (error) showError('Không đăng nhập được Google. Vui lòng kiểm tra cấu hình Supabase Auth.');
}

async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}

/* ── HELPERS (ported from Telegram bot) ── */
function isShopeeLink(url) {
  return url.includes('shopee.vn') ||
    url.includes('s.shopee.vn') ||
    url.includes('shope.ee') ||
    url.includes('shp.ee');
}

function needsResolve(url) {
  if (url.includes('an_redir')) return false;
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === 'shopee.vn') {
      return !pathname.startsWith('/product/') && !/-i\.\d+/.test(pathname);
    }
    return true; // shp.ee, shope.ee, vn.shp.ee, etc. đều cần resolve
  } catch { return false; }
}

function normalizeShopeeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'shopee.vn' && parsed.pathname.startsWith('/product/')) {
      parsed.search = '';
      parsed.hash = '';
    }
    return parsed.toString();
  } catch { return url; }
}

// Gọi public Redirect Checker API (CORS-enabled, không cần API key) để resolve redirect server-side
async function resolveShortUrl(url) {
  const response = await fetch('https://www.redirectcheck.org/api/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: url,
      method: 'GET',
      followMetaRefresh: true
    })
  });

  if (!response.ok) throw new Error('API error');

  const data = await response.json();
  const resolvedUrl = data.final_result?.final_url || (data.redirects && data.redirects[0]?.to);

  if (!resolvedUrl || !resolvedUrl.includes('shopee.vn')) {
    throw new Error('Could not resolve to shopee.vn');
  }

  return normalizeShopeeUrl(resolvedUrl);
}

async function createTrackedAffLink(originalLink, normalizedLink) {
  const { data, error } = await supabaseClient.functions.invoke('convert-link', {
    body: {
      original_url: originalLink,
      normalized_url: normalizedLink
    }
  });

  if (error || !data?.affiliate_url) {
    throw new Error(await getSupabaseFunctionError(error, data));
  }

  return data;
}

async function getSupabaseFunctionError(error, data) {
  if (data?.error) return data.error;

  if (error?.context) {
    try {
      const body = await error.context.clone().json();
      if (body?.error) return body.error;
    } catch {
      try {
        const text = await error.context.clone().text();
        if (text) return text;
      } catch { }
    }
  }

  return error?.message || 'Could not create affiliate link';
}

/* ── MAIN CONVERT FUNCTION ── */
async function convertLink() {
  const input = document.getElementById('shopeeLink');
  const btn = document.getElementById('convertBtn');
  const label = document.getElementById('btnLabel');
  const spinner = document.getElementById('spinner');
  const errorMsg = document.getElementById('errorMsg');
  const resultBox = document.getElementById('resultBox');
  const resultLink = document.getElementById('resultLink');

  const rawUrl = input.value.trim();

  // Reset UI
  input.classList.remove('error');
  errorMsg.classList.remove('show');
  resultBox.classList.remove('show');

  if (!rawUrl) {
    showError('Vui lòng paste link sản phẩm Shopee vào.');
    input.classList.add('error');
    input.focus();
    return;
  }

  if (!supabaseClient) {
    showError('Chưa cấu hình Supabase. Hãy điền SUPABASE_URL và SUPABASE_ANON_KEY trước.');
    return;
  }

  if (!currentUser) {
    showError('Vui lòng đăng nhập Google trước khi chuyển link để hệ thống ghi nhận hoa hồng cho bạn.');
    return;
  }

  if (!isShopeeLink(rawUrl)) {
    showError('Link không hợp lệ. Vui lòng dùng link từ shopee.vn, shope.ee hoặc shp.ee.');
    input.classList.add('error');
    return;
  }

  btn.disabled = true;
  label.textContent = 'Đang xử lý…';
  spinner.style.display = 'block';

  try {
    let finalUrl = rawUrl;

    if (needsResolve(rawUrl)) {
      // Resolve redirect qua Redirect Checker API (chạy trực tiếp dưới client, không bị CORS block)
      label.textContent = 'Đang resolve link…';
      try {
        finalUrl = await resolveShortUrl(rawUrl);
      } catch (e) {
        // Fallback: dùng URL gốc nếu không resolve được
        console.warn('Resolve failed, using raw URL:', e);
        finalUrl = rawUrl;
      }
    } else {
      finalUrl = normalizeShopeeUrl(rawUrl);
    }

    const trackedLink = await createTrackedAffLink(rawUrl, finalUrl);
    const affLink = trackedLink.affiliate_url;
    currentAffiliateLinkId = trackedLink.id;
    const openBtn = document.getElementById('shopeeOpenBtn');
    openBtn.href = affLink;
    openBtn.onclick = () => trackAffiliateClick(currentAffiliateLinkId);
    resultLink.textContent = affLink;
    resultBox.classList.add('show');
    loadLinkHistory();

    const copyBtn = document.getElementById('copyBtn');
    copyBtn.textContent = 'Sao chép';
    copyBtn.classList.remove('copied');

  } catch (err) {
    showError(`Không convert được link: ${err.message}`);
    console.error(err);
  } finally {
    btn.disabled = false;
    label.textContent = 'Chuyển Link';
    spinner.style.display = 'none';
  }
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.add('show');
}

async function copyLink() {
  const link = document.getElementById('resultLink').textContent;
  const btn = document.getElementById('copyBtn');
  try {
    await navigator.clipboard.writeText(link);
    btn.textContent = 'Đã chép!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Sao chép';
      btn.classList.remove('copied');
    }, 2500);
  } catch {
    // Fallback select
    const range = document.createRange();
    const el = document.getElementById('resultLink');
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }
}

async function pasteLink() {
  const input = document.getElementById('shopeeLink');
  const pasteBtn = document.getElementById('pasteBtn');
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      input.value = text;
      input.focus();

      // Micro-animation / feedback
      pasteBtn.textContent = '✅ Đã dán';
      setTimeout(() => {
        pasteBtn.textContent = '📋 Dán';
      }, 1500);
    }
  } catch (err) {
    console.warn("Clipboard access denied or not supported:", err);
    // Focus the input to let the user paste manually if permission is blocked
    input.focus();
    // Prompt user
    const originalText = pasteBtn.textContent;
    pasteBtn.textContent = '❌ Lỗi';
    setTimeout(() => {
      pasteBtn.textContent = originalText;
    }, 1500);
  }
}

async function loadLinkHistory() {
  if (!supabaseClient || !currentUser) return;

  const historyList = document.getElementById('historyList');
  historyList.innerHTML = '<div class="history-empty">Đang tải lịch sử link...</div>';

  const { data, error } = await supabaseClient
    .from('affiliate_links')
    .select('id, sub_id, affiliate_url, normalized_url, created_at')
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) {
    historyList.innerHTML = '<div class="history-empty">Không tải được lịch sử link. Hãy kiểm tra RLS/schema Supabase.</div>';
    console.error(error);
    return;
  }

  renderHistory(data || []);
}

async function trackAffiliateClick(affiliateLinkId) {
  if (!supabaseClient || !currentUser || !affiliateLinkId) return;

  try {
    await supabaseClient.functions.invoke('record-click', {
      body: { affiliate_link_id: affiliateLinkId }
    });
  } catch (error) {
    console.warn('Could not record click:', error);
  }
}

function renderHistory(links) {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;

  if (!links.length) {
    historyList.innerHTML = '<div class="history-empty">Bạn chưa tạo link nào.</div>';
    return;
  }

  historyList.innerHTML = links.map(link => {
    const createdAt = new Date(link.created_at).toLocaleString('vi-VN');
    const displayUrl = escapeHtml(link.normalized_url || link.affiliate_url);
    const affiliateUrl = escapeHtml(link.affiliate_url);
    const subId = escapeHtml(link.sub_id);
    const linkId = escapeHtml(link.id);

    return `
      <div class="history-item">
        <div class="history-meta">
          <span>${createdAt}</span>
          <span class="history-subid">${subId}</span>
        </div>
        <a class="history-link" href="${affiliateUrl}" target="_blank" rel="noopener" onclick="trackAffiliateClick('${linkId}')">${displayUrl}</a>
      </div>
    `;
  }).join('');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Enter key support
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

/* ── INITIALIZE REFERRAL CODE ── */
function getActiveReferralCode() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  if (REFERRAL_CONFIG.specialDates[dateStr]) {
    return REFERRAL_CONFIG.specialDates[dateStr];
  }

  const dayOfWeek = today.getDay();
  if (REFERRAL_CONFIG.weeklyCodes && REFERRAL_CONFIG.weeklyCodes[dayOfWeek]) {
    return REFERRAL_CONFIG.weeklyCodes[dayOfWeek];
  }

  return REFERRAL_CONFIG.defaultCode;
}

function initReferralCode() {
  const codeBox = document.querySelector('.referral-code-box');
  if (codeBox) {
    const activeCode = getActiveReferralCode();
    codeBox.textContent = activeCode;

    codeBox.title = "Click để sao chép mã giới thiệu";
    codeBox.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(activeCode);
        codeBox.textContent = "ĐÃ CHÉP!";
        codeBox.style.background = "#2ecc71";
        codeBox.style.color = "#ffffff";
        codeBox.style.borderColor = "#2ecc71";

        setTimeout(() => {
          codeBox.textContent = activeCode;
          codeBox.style.background = "#ffffff";
          codeBox.style.color = "var(--orange)";
          codeBox.style.borderColor = "var(--orange-light)";
        }, 1500);
      } catch (err) {
        console.error("Could not copy referral code:", err);
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initReferralCode();
  initAuth();
});
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initReferralCode();
  initAuth();
}
