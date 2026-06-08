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
