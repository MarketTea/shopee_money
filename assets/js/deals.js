/**
 * deals.js
 * Load và render deal campaigns từ Supabase lên trang deals.html
 *
 * Những thay đổi so với bản cũ (xem báo cáo review):
 *  - Không còn tự build affiliate_url rồi gửi lên server (sub_id mismatch).
 *    Server (RPC generate_deal_affiliate_link) tự sinh sub_id + URL.
 *  - Deal hết hạn: disable nút mua (trước đây vẫn mua được).
 *  - Không dùng inline onclick → event delegation (tránh vỡ nút khi tên có dấu ').
 *  - Một ticker countdown duy nhất thay vì 1 setInterval / campaign.
 *  - Không tự mở tab Shopee sau khi login (bị popup blocker + bất ngờ cho user).
 */

const DEAL_COLUMNS = [
  'id', 'title', 'brand', 'category', 'start_date', 'end_date',
  'highlights', 'voucher_codes', 'store_url', 'is_active', 'sort_order', 'created_at'
].join(',');

const DEAL_PRODUCT_COLUMNS = [
  'id', 'name', 'description', 'affiliate_url',
  'discount_label', 'has_gift', 'gift_description', 'sort_order'
].join(',');

const DEAL_PENDING_KEY = 'pending_deal_product';
const DEAL_PENDING_TTL_MS = 30 * 60 * 1000;

let allCampaigns = [];
let activeFilter = 'Tất cả';
let countdownTimerId = null;
let pendingDealProduct = null;
let dealsUiBound = false;
let visibilityBound = false;

/* ── Khởi tạo ─────────────────────────────────────────────────────────────── */

async function initDeals() {
  // Chờ auth resolve để biết chắc currentUser trước khi render / click
  if (typeof waitForAuth === 'function') {
    try {
      await waitForAuth();
    } catch (err) {
      console.warn('Không chờ được trạng thái đăng nhập:', err);
    }
  }

  bindDealsUi();
  await loadDeals();
}

/* ── Data ─────────────────────────────────────────────────────────────────── */

async function loadDeals() {
  const container = document.getElementById('dealsContainer');
  const loadingEl = document.getElementById('dealsLoading');
  const emptyEl = document.getElementById('dealsEmpty');

  if (loadingEl) loadingEl.style.display = 'flex';
  if (emptyEl) emptyEl.style.display = 'none';
  if (container) container.innerHTML = '';

  if (!supabaseClient) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('deal_campaigns')
      .select(`${DEAL_COLUMNS}, deal_products ( ${DEAL_PRODUCT_COLUMNS} )`)
      .eq('is_active', true)
      .order('end_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    allCampaigns = sortCampaigns((data || []).map(normalizeCampaign));

    if (loadingEl) loadingEl.style.display = 'none';

    if (!allCampaigns.length) {
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }

    buildFilterTabs();
    renderCampaigns(currentlyFiltered());
    startCountdownTicker();
    checkPendingDealPurchase();
  } catch (err) {
    console.error('Lỗi tải deals:', err);
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'flex';
  }
}

function normalizeCampaign(campaign) {
  const products = Array.isArray(campaign.deal_products) ? campaign.deal_products : [];
  const vouchers = Array.isArray(campaign.voucher_codes) ? campaign.voucher_codes : [];

  return {
    ...campaign,
    highlights: Array.isArray(campaign.highlights) ? campaign.highlights.filter(Boolean) : [],
    voucher_codes: vouchers.filter((voucher) => voucher && voucher.code),
    deal_products: products
      .filter((product) => product && product.id && product.affiliate_url)
      .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
  };
}

/** Deal còn hạn lên trước; trong cùng nhóm thì hết hạn sớm hơn lên trước. */
function sortCampaigns(campaigns) {
  return [...campaigns].sort((a, b) => {
    const expiredA = isCampaignExpired(a);
    const expiredB = isCampaignExpired(b);
    if (expiredA !== expiredB) return expiredA ? 1 : -1;

    const endA = a.end_date || '9999-12-31';
    const endB = b.end_date || '9999-12-31';
    if (endA !== endB) return endA < endB ? -1 : 1;

    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

/* ── Filter tabs ──────────────────────────────────────────────────────────── */

function buildFilterTabs() {
  const tabsEl = document.getElementById('dealFilterTabs');
  if (!tabsEl) return;

  const categories = ['Tất cả', ...new Set(allCampaigns.map((c) => c.category || 'Khác'))];
  if (!categories.includes(activeFilter)) activeFilter = 'Tất cả';

  tabsEl.innerHTML = categories.map((category) => {
    const active = category === activeFilter;
    return `
      <button
        type="button"
        class="deal-filter-btn ${active ? 'active' : ''}"
        data-category="${escapeHtml(category)}"
        aria-pressed="${active ? 'true' : 'false'}"
      >
        ${getCategoryIcon(category)} ${escapeHtml(category)}
      </button>
    `;
  }).join('');
}

function filterDeals(category) {
  activeFilter = category || 'Tất cả';

  document.querySelectorAll('.deal-filter-btn').forEach((btn) => {
    const isActive = btn.dataset.category === activeFilter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });

  renderCampaigns(currentlyFiltered());
}

function currentlyFiltered() {
  if (activeFilter === 'Tất cả') return allCampaigns;
  return allCampaigns.filter((c) => (c.category || 'Khác') === activeFilter);
}

function getCategoryIcon(category) {
  const icons = {
    Beauty: '💄', Fashion: '👗', Tech: '⚡', Food: '🍜',
    Voucher: '🎟️', Khác: '🛍️', 'Tất cả': '🔥'
  };
  return icons[category] || '🛍️';
}

/* ── Render ───────────────────────────────────────────────────────────────── */

function renderCampaigns(campaigns) {
  const container = document.getElementById('dealsContainer');
  if (!container) return;

  if (!campaigns.length) {
    container.innerHTML = `
      <div class="deals-no-result">
        <div style="font-size:2.5rem">🔍</div>
        <p>Không có deal nào trong danh mục này</p>
      </div>`;
    return;
  }

  container.innerHTML = campaigns.map(renderCampaignCard).join('');
  tickCountdowns();
}

function renderCampaignCard(campaign) {
  const expired = isCampaignExpired(campaign);
  const products = campaign.deal_products || [];
  const vouchers = campaign.voucher_codes || [];
  const highlights = campaign.highlights || [];
  const urgency = getUrgencyStatus(campaign.end_date);

  const urgencyBadge = urgency
    ? `<span class="deal-urgency-badge ${urgency.class}">${urgency.label}</span>`
    : '';

  const highlightsHtml = highlights.length
    ? `<div class="deal-highlights">
         ${highlights.map((h) => `<span class="deal-highlight-tag">✅ ${escapeHtml(h)}</span>`).join('')}
       </div>`
    : '';

  const vouchersHtml = vouchers.length
    ? `<div class="deal-vouchers">
         <div class="deal-vouchers-title">🎟️ Mã Voucher</div>
         <div class="deal-voucher-list">${vouchers.map(renderVoucherChip).join('')}</div>
       </div>`
    : '';

  const productsHtml = products.length
    ? `<div class="deal-products-section">
         <div class="deal-section-title">🛒 Sản phẩm deal</div>
         <div class="deal-products-grid">${products.map((p) => renderProductCard(p, expired)).join('')}</div>
       </div>`
    : '';

  const storeBtn = campaign.store_url
    ? `<a href="${escapeHtml(campaign.store_url)}" target="_blank" rel="noopener noreferrer" class="deal-store-btn">
         🏪 Xem toàn bộ gian hàng
       </a>`
    : '';

  const footerHtml = storeBtn
    ? `<div class="deal-card-footer">${storeBtn}</div>`
    : '';

  const dateLabel = formatDateRange(campaign.start_date, campaign.end_date);
  const countdown = campaign.end_date && !expired
    ? `<span class="deal-countdown" data-countdown="${escapeHtml(campaign.end_date)}" role="timer" aria-live="off"></span>`
    : (expired ? '<span class="deal-countdown expired">⏰ Đã kết thúc</span>' : '');

  return `
    <article class="deal-campaign-card visible" data-campaign-id="${escapeHtml(campaign.id)}">
      <div class="deal-card-header">
        <div class="deal-card-meta">
          <span class="deal-category-badge">${getCategoryIcon(campaign.category)} ${escapeHtml(campaign.category || 'Khác')}</span>
          ${dateLabel ? `<span class="deal-date-label">📅 ${escapeHtml(dateLabel)}</span>` : ''}
          ${countdown}
        </div>
        ${urgencyBadge}
      </div>

      <h2 class="deal-campaign-title">${escapeHtml(campaign.title)}</h2>
      ${campaign.brand ? `<div class="deal-brand-name">${escapeHtml(campaign.brand)}</div>` : ''}

      ${highlightsHtml}
      ${vouchersHtml}
      ${productsHtml}

      ${footerHtml}
    </article>
  `;
}

function renderProductCard(product, expired) {
  const giftBadge = product.has_gift
    ? '<span class="product-gift-badge">🎁 Có quà</span>'
    : '';
  const discountBadge = product.discount_label
    ? `<span class="product-discount-badge">${escapeHtml(product.discount_label)}</span>`
    : '';
  const giftDesc = product.has_gift && product.gift_description
    ? `<div class="product-gift-desc">🎁 ${escapeHtml(product.gift_description)}</div>`
    : '';

  const buyLabel = expired ? 'Đã kết thúc' : 'Mua ngay →';
  const cashbackLabel = expired ? 'Hết hạn' : 'Hoàn tiền ví';
  const disabledAttrs = expired
    ? 'disabled aria-disabled="true" style="opacity:.55; cursor:not-allowed;"'
    : '';
  const titleText = expired
    ? 'Deal đã kết thúc'
    : 'Bấm để mua trên Shopee và nhận hoàn tiền vào ví';

  return `
    <div class="deal-product-card" data-product-card="${escapeHtml(product.id)}">
      <div class="product-badges">${giftBadge}${discountBadge}</div>
      <div class="product-name" title="${escapeHtml(product.name)}">
        <span class="product-name-text">${escapeHtml(product.name)}</span>
      </div>
      ${giftDesc}
      <button
        type="button"
        class="btn-buy-now"
        data-action="buy"
        data-product-id="${escapeHtml(product.id)}"
        title="${escapeHtml(titleText)}"
        aria-label="${escapeHtml(`${buyLabel} — ${product.name}`)}"
        ${disabledAttrs}
      >
        <span>${buyLabel}</span>
        <span class="buy-cashback-badge">${cashbackLabel}</span>
      </button>
    </div>
  `;
}

function renderVoucherChip(voucher) {
  const desc = voucher.desc ? ` — ${voucher.desc}` : '';
  return `
    <button
      type="button"
      class="voucher-chip"
      data-action="copy-voucher"
      data-code="${escapeHtml(voucher.code)}"
      title="Click để copy mã"
    >
      <span class="voucher-code">${escapeHtml(voucher.code)}</span>
      <span class="voucher-copy-icon">📋</span>
      <span class="voucher-desc">${escapeHtml(desc)}</span>
    </button>
  `;
}

/* ── Event delegation (thay cho inline onclick) ───────────────────────────── */

function bindDealsUi() {
  if (dealsUiBound) return;
  dealsUiBound = true;

  const tabsEl = document.getElementById('dealFilterTabs');
  if (tabsEl) {
    tabsEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-category]');
      if (btn) filterDeals(btn.dataset.category);
    });
  }

  const container = document.getElementById('dealsContainer');
  if (container) {
    container.addEventListener('click', (event) => {
      const buyBtn = event.target.closest('[data-action="buy"]');
      if (buyBtn) {
        if (buyBtn.disabled) return;
        handleBuyDeal(buyBtn.dataset.productId, buyBtn);
        return;
      }

      const voucherBtn = event.target.closest('[data-action="copy-voucher"]');
      if (voucherBtn) copyVoucher(voucherBtn.dataset.code || '', voucherBtn);
    });
  }
}

/* ── Voucher ──────────────────────────────────────────────────────────────── */

async function copyVoucher(code, btn) {
  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
    showToast(`✅ Đã copy mã: ${code}`);
  } catch (err) {
    const el = document.createElement('textarea');
    el.value = code;
    el.setAttribute('readonly', 'readonly');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
      showToast(`✅ Đã copy mã: ${code}`);
    } catch (fallbackErr) {
      showToast('⚠️ Không copy được, bạn hãy copy thủ công: ' + code);
    }
    el.remove();
    return;
  }

  if (btn) {
    const icon = btn.querySelector('.voucher-copy-icon');
    if (icon) {
      icon.textContent = '✅';
      setTimeout(() => { icon.textContent = '📋'; }, 2000);
    }
  }
}

/* ── Mua hàng ─────────────────────────────────────────────────────────────── */

function findProductById(productId) {
  for (const campaign of allCampaigns) {
    const found = (campaign.deal_products || []).find((product) => product.id === productId);
    if (found) return found;
  }
  return null;
}

function findCampaignByProductId(productId) {
  return allCampaigns.find((campaign) =>
    (campaign.deal_products || []).some((product) => product.id === productId)
  ) || null;
}

function buildShopeeAffiliateUrl(targetUrl, subId) {
  const affiliateId = (typeof SHOPEE_AFFILIATE_ID !== 'undefined' && SHOPEE_AFFILIATE_ID)
    ? SHOPEE_AFFILIATE_ID
    : '17305840167';
  const cleanTarget = String(targetUrl || '').split('#')[0].trim();
  return `https://s.shopee.vn/an_redir?origin_link=${encodeURIComponent(cleanTarget)}`
    + `&affiliate_id=${affiliateId}&sub_id=${encodeURIComponent(subId)}`;
}

/** Chỉ chấp nhận link redirect Shopee do server trả về. */
function isShopeeAffiliateUrl(url) {
  return /^https:\/\/s\.shopee\.vn\/an_redir\?/i.test(String(url || ''));
}

function buildFallbackSubId() {
  const userPart = (currentUser && currentUser.id)
    ? String(currentUser.id).replace(/[^a-z0-9]/gi, '').slice(0, 8)
    : 'guest';
  const randomPart = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `u_${userPart}_l_${randomPart}`;
}

function handleBuyDeal(productId, btnElement) {
  const product = findProductById(productId);
  if (!product) {
    showToast('⚠️ Không tìm thấy thông tin sản phẩm.');
    return;
  }

  const campaign = findCampaignByProductId(productId);
  if (campaign && isCampaignExpired(campaign)) {
    showToast('⏰ Deal này đã kết thúc.');
    return;
  }

  pendingDealProduct = product;

  if (currentUser) {
    buyProductWithCashback(product, btnElement);
  } else {
    openDealAuthModal(product);
  }
}

async function buyProductWithCashback(product, btnElement) {
  if (!product || !currentUser) return;

  const originalContent = btnElement ? btnElement.innerHTML : '';
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.innerHTML = '<span class="deal-btn-spinner"></span> <span>Đang tạo link...</span>';
  }

  // Mở tab trước khi await để không bị popup blocker
  const newTab = window.open('about:blank', '_blank');

  const openUrl = (url) => {
    if (newTab && !newTab.closed) {
      newTab.location.href = url;
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  try {
    let finalUrl = '';

    if (supabaseClient) {
      // KHÔNG gửi URL lên nữa — server tự sinh sub_id + affiliate_url
      const { data, error } = await supabaseClient.rpc('generate_deal_affiliate_link', {
        p_product_id: product.id
      });

      if (error) throw error;
      finalUrl = data && data.affiliate_url ? String(data.affiliate_url) : '';
    }

    if (!isShopeeAffiliateUrl(finalUrl)) {
      throw new Error('RPC không trả về link Shopee hợp lệ');
    }

    openUrl(finalUrl);
    showToast('🎉 Đang mở Shopee! Đơn hàng này sẽ được hoàn tiền tự động vào ví.');
  } catch (err) {
    console.error('Lỗi tạo link hoàn tiền deal:', err);

    // Vẫn cho user mua, nhưng nói rõ là có thể không được hoàn tiền tự động
    openUrl(buildShopeeAffiliateUrl(product.affiliate_url, buildFallbackSubId()));
    showToast('⚠️ Chưa tạo được link hoàn tiền — đơn này có thể KHÔNG được hoàn tiền tự động.');
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.innerHTML = originalContent
        || '<span>Mua ngay →</span><span class="buy-cashback-badge">Hoàn tiền ví</span>';
    }
  }
}

/* ── Modal đăng nhập ──────────────────────────────────────────────────────── */

function openDealAuthModal(product) {
  const modal = document.getElementById('dealAuthModal');
  const nameEl = document.getElementById('dealModalProductName');

  if (nameEl && product) nameEl.textContent = product.name || 'Sản phẩm Shopee';

  if (!modal) return;
  if (typeof modal.showModal === 'function') modal.showModal();
  else modal.classList.add('show');
}

function closeDealAuthModal() {
  const modal = document.getElementById('dealAuthModal');
  if (!modal) return;
  if (typeof modal.close === 'function') modal.close();
  else modal.classList.remove('show');
}

function dealAuthLoginAndProceed() {
  if (pendingDealProduct) {
    try {
      localStorage.setItem(DEAL_PENDING_KEY, JSON.stringify({
        id: pendingDealProduct.id,
        ts: Date.now()
      }));
    } catch (err) {
      console.warn('Không lưu được sản phẩm chờ:', err);
    }
  }

  closeDealAuthModal();
  if (typeof signInWithGoogle === 'function') signInWithGoogle();
}

function dealProceedWithoutLogin() {
  closeDealAuthModal();
  if (!pendingDealProduct) return;

  const guestUrl = buildShopeeAffiliateUrl(pendingDealProduct.affiliate_url, 'deal_guest');
  window.open(guestUrl, '_blank', 'noopener,noreferrer');
  showToast('🛍️ Đang chuyển sang Shopee để bạn mua hàng...');
}

/**
 * Sau khi login xong: chỉ highlight + nhắc user bấm "Mua ngay".
 * Không tự mở Shopee (popup blocker + hành vi bất ngờ).
 */
function checkPendingDealPurchase() {
  let pending = null;
  try {
    pending = JSON.parse(localStorage.getItem(DEAL_PENDING_KEY) || 'null');
  } catch (err) {
    pending = null;
  }

  try {
    localStorage.removeItem(DEAL_PENDING_KEY);
  } catch (err) {
    /* ignore */
  }

  if (!pending || !pending.id) return;
  if (!/^[0-9a-fA-F-]{36}$/.test(String(pending.id))) return;   // chặn selector injection
  if (!pending.ts || Date.now() - pending.ts > DEAL_PENDING_TTL_MS) return;
  if (!currentUser) return;

  const product = findProductById(pending.id);
  if (!product) return;

  const card = document.querySelector(`[data-product-card="${pending.id}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('is-highlighted');
    setTimeout(() => card.classList.remove('is-highlighted'), 2500);
  }

  showToast('✅ Đã đăng nhập! Bấm "Mua ngay" để nhận hoàn tiền cho sản phẩm này.');
}

/* ── Countdown ────────────────────────────────────────────────────────────── */

/** ISO date (YYYY-MM-DD) có thật hay không (chặn 2026-16-15). */
function isValidIsoDate(value) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}

/** ISO date (YYYY-MM-DD) → Date cuối ngày theo giờ local, hoặc null nếu sai. */
function parseDealEnd(value) {
  if (!isValidIsoDate(value)) return null;
  const date = new Date(`${value}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isCampaignExpired(campaign) {
  const end = parseDealEnd(campaign && campaign.end_date);
  return end ? end.getTime() < Date.now() : false;
}

function getUrgencyStatus(endDateStr) {
  const end = parseDealEnd(endDateStr);
  if (!end) return null;

  const diffMs = end.getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / 86400000);

  if (diffMs < 0) return { label: '⏰ Đã hết hạn', class: 'expired' };
  if (diffDays <= 1) return { label: '🔥 Hôm nay hết!', class: 'urgent' };
  if (diffDays <= 3) return { label: `⚡ Còn ${diffDays} ngày`, class: 'soon' };
  return null;
}

function startCountdownTicker() {
  if (countdownTimerId) clearInterval(countdownTimerId);

  countdownTimerId = setInterval(tickCountdowns, 1000);

  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (countdownTimerId) clearInterval(countdownTimerId);
        countdownTimerId = null;
        return;
      }
      tickCountdowns();
      if (!countdownTimerId) countdownTimerId = setInterval(tickCountdowns, 1000);
    });
  }
}

function tickCountdowns() {
  const nodes = document.querySelectorAll('[data-countdown]');

  if (!nodes.length) {
    if (countdownTimerId) clearInterval(countdownTimerId);
    countdownTimerId = null;
    return;
  }

  nodes.forEach((el) => {
    const end = parseDealEnd(el.dataset.countdown);
    if (!end) {
      el.textContent = '';
      return;
    }

    const diffMs = end.getTime() - Date.now();

    if (diffMs <= 0) {
      el.textContent = '⏰ Đã kết thúc';
      el.className = 'deal-countdown expired';
      return;
    }

    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    const clock = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (days > 3) {
      el.textContent = `⏳ Còn ${days} ngày`;
      el.className = 'deal-countdown normal';
    } else if (days > 0) {
      el.textContent = `⚡ ${days}n ${clock}`;
      el.className = 'deal-countdown soon';
    } else {
      el.textContent = `🔥 ${clock}`;
      el.className = 'deal-countdown urgent';
    }
  });
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function formatDateRange(start, end) {
  const fmt = (value) => {
    if (!isValidIsoDate(value)) return '';
    const [, month, day] = String(value).split('-');
    return `${day}/${month}`;
  };

  const from = fmt(start);
  const to = fmt(end);

  if (!from && !to) return '';
  if (!from) return to;
  if (!to || from === to) return from;
  return `${from} – ${to}`;
}

/* ── Đóng modal khi click backdrop ────────────────────────────────────────── */

window.addEventListener('click', (event) => {
  const modal = document.getElementById('dealAuthModal');
  if (modal && event.target === modal) closeDealAuthModal();
});
