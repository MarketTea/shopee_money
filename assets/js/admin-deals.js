/**
 * admin-deals.js
 * Quản lý deal campaigns - chỉ dành cho admin (KOL/owner)
 *
 * Lưu ý bảo mật: ADMIN_EMAILS chỉ là lớp UI (ẩn/hiện).
 * Quyền ghi thật nằm ở RLS + bảng public.deal_admins
 * (xem migration 202610190001_deal_hardening.sql).
 */

const ADMIN_EMAILS = ['nducthien96@gmail.com'];

let parsedCampaigns = [];
let existingCampaigns = [];
let previewEventsBound = false;
let existingEventsBound = false;
let adminBootstrapping = false;
let adminReady = false;

// Khoá campaign đã publish thành công trong phiên này.
// Tránh tạo bản trùng khi admin bấm "Preview Parse" lại rồi "Publish" lần 2
// (hoặc publish lại sau khi 1 phần campaign bị lỗi).
const publishedCampaignKeys = new Set();

/* ── Khởi tạo ─────────────────────────────────────────────────────────────── */

async function initAdminDeals() {
  if (adminBootstrapping || adminReady) return;

  if (!supabaseClient) {
    showAdminError('Chưa cấu hình Supabase nên không thể mở trang quản trị.');
    return;
  }

  adminBootstrapping = true;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
      showAdminError('Bạn cần đăng nhập để truy cập trang này.');
      return;
    }

    const userEmail = (session.user.email || '').toLowerCase();
    if (ADMIN_EMAILS.length > 0 && !ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(userEmail)) {
      showAdminError(`Tài khoản "${session.user.email}" không nằm trong danh sách quản trị viên.`);
      return;
    }

    const loginSection = document.getElementById('adminLoginSection');
    const mainSection = document.getElementById('adminMainSection');
    if (loginSection) loginSection.style.display = 'none';
    if (mainSection) mainSection.style.display = 'block';

    const emailEl = document.getElementById('adminUserEmail');
    if (emailEl) emailEl.textContent = session.user.email;

    adminReady = true;
    bindAdminUi();
    await loadExistingCampaigns();
  } finally {
    adminBootstrapping = false;
  }
}

/* ── Danh sách campaign hiện có ───────────────────────────────────────────── */

async function loadExistingCampaigns() {
  const listEl = document.getElementById('existingCampaignsList');
  if (!listEl) return;

  listEl.innerHTML = '<div class="admin-loading">Đang tải...</div>';

  try {
    const { data, error } = await supabaseClient
      .from('deal_campaigns')
      .select('id, title, brand, category, start_date, end_date, is_active, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    existingCampaigns = data || [];
    renderExistingCampaigns(existingCampaigns);
  } catch (err) {
    listEl.innerHTML = `<div class="admin-error">Lỗi tải dữ liệu: ${escapeHtml(err.message)}</div>`;
  }
}

function renderExistingCampaigns(campaigns) {
  const listEl = document.getElementById('existingCampaignsList');
  if (!listEl) return;

  if (!campaigns.length) {
    listEl.innerHTML = '<div class="admin-empty">Chưa có deal nào. Hãy paste và publish deal đầu tiên!</div>';
    return;
  }

  listEl.innerHTML = campaigns.map((campaign) => `
    <div class="admin-campaign-row ${campaign.is_active ? '' : 'inactive'}">
      <div class="admin-campaign-info">
        <div class="admin-campaign-title">${escapeHtml(campaign.title)}</div>
        <div class="admin-campaign-meta">
          <span class="admin-badge category">${escapeHtml(campaign.category || 'Khác')}</span>
          ${campaign.end_date ? `<span class="admin-badge date">📅 đến ${escapeHtml(campaign.end_date)}</span>` : ''}
          <span class="admin-badge ${campaign.is_active ? 'active' : 'inactive'}">
            ${campaign.is_active ? '✅ Active' : '⏸ Ẩn'}
          </span>
        </div>
      </div>
      <div class="admin-campaign-actions">
        <button
          type="button"
          data-action="toggle"
          data-id="${escapeHtml(campaign.id)}"
          data-next="${campaign.is_active ? '0' : '1'}"
          class="admin-btn ${campaign.is_active ? 'btn-hide' : 'btn-show'}"
        >${campaign.is_active ? 'Ẩn' : 'Hiện'}</button>
        <button
          type="button"
          data-action="delete"
          data-id="${escapeHtml(campaign.id)}"
          data-title="${escapeHtml(campaign.title)}"
          class="admin-btn btn-delete"
        >Xóa</button>
      </div>
    </div>
  `).join('');
}

/* ── Preview parse ────────────────────────────────────────────────────────── */

function previewParsedContent() {
  const textarea = document.getElementById('dealRawContent');
  if (!textarea) return;

  const rawText = textarea.value.trim();
  if (!rawText) {
    showToast('⚠️ Vui lòng paste nội dung vào ô text!');
    return;
  }

  parsedCampaigns = parseDealContent(rawText);
  renderParsePreview();
}

/** Vẽ lại khung preview từ parsedCampaigns hiện tại (không parse lại textarea). */
function renderParsePreview() {
  const previewEl = document.getElementById('parsePreview');
  const previewSection = document.getElementById('parsePreviewSection');
  if (!previewEl || !previewSection) return;

  if (!parsedCampaigns.length) {
    previewEl.innerHTML = `
      <div class="parse-error">
        ❌ Không nhận dạng được campaign nào. Hãy đảm bảo nội dung có dấu phân cách <code>===</code> giữa các chiến dịch.
      </div>`;
    previewSection.style.display = 'block';
    updatePublishButtonState();
    return;
  }

  const warnings = buildParseWarnings();

  previewEl.innerHTML = `
    <div style="background: #F0FDF4; border: 2px solid #16A34A; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.88rem; color: #166534; box-shadow: 2px 2px 0px #000;">
      <strong>💎 Mô hình A (Chia hoa hồng):</strong> Toàn bộ link sản phẩm khi publish sẽ tự động gắn
      <strong>Affiliate ID: 17305840167</strong> của Admin. Khi User bấm mua, hệ thống tự động sinh mã
      <code>sub_id</code> định danh User để hoàn tiền vào ví khi đối soát CSV.
    </div>
    ${warnings}
  ` + parsedCampaigns.map(renderParsedCampaign).join('');

  previewSection.style.display = 'block';
  bindPreviewEvents();
  updatePublishButtonState();
}

function buildParseWarnings() {
  const warnings = [];

  parsedCampaigns.forEach((campaign, idx) => {
    if (!campaign.start_date && !campaign.end_date) {
      warnings.push(`#${idx + 1} chưa nhận diện được ngày diễn ra`);
    }
    if (!campaign.products.length) {
      warnings.push(`#${idx + 1} không có sản phẩm kèm link affiliate`);
    }
  });

  if (!warnings.length) return '';

  return `
    <div style="background:#FFF7CC; border:2px solid #F0C000; border-radius:8px; padding:0.7rem 1rem; margin-bottom:1rem; font-size:0.84rem; color:#856D00;">
      ⚠️ <strong>Cần kiểm tra:</strong> ${warnings.map(escapeHtml).join(' · ')}.
      Bạn có thể sửa trực tiếp ngày bên dưới trước khi publish.
    </div>`;
}

function renderParsedCampaign(campaign, idx) {
  const products = campaign.products.slice(0, 3);

  return `
    <div class="parse-result-item">
      <div class="parse-result-header">
        <span class="parse-result-num">${idx + 1}</span>
        <div style="flex:1; min-width:0;">
          <div class="parse-result-title">✅ ${escapeHtml(campaign.title)}</div>
          <div class="parse-result-meta">
            ${campaign.brand ? `<span>🏷️ ${escapeHtml(campaign.brand)}</span>` : ''}
            <span>📂 ${escapeHtml(campaign.category || 'Khác')}</span>
            ${campaign.end_date ? `<span>📅 ${escapeHtml(campaign.end_date)}</span>` : ''}
            <span>🛒 ${campaign.products.length} sản phẩm</span>
            ${campaign.voucher_codes.length ? `<span>🎟️ ${campaign.voucher_codes.length} voucher</span>` : ''}
          </div>

          <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; margin-top:0.5rem; font-size:0.8rem; font-weight:700;">
            <label style="display:flex; gap:0.35rem; align-items:center;">
              📅 Từ
              <input type="date" data-idx="${idx}" data-field="start_date"
                value="${escapeHtml(campaign.start_date || '')}"
                style="font-family:inherit;font-size:0.8rem;padding:0.2rem 0.4rem;border:2px solid #000;border-radius:4px;">
            </label>
            <label style="display:flex; gap:0.35rem; align-items:center;">
              đến
              <input type="date" data-idx="${idx}" data-field="end_date"
                value="${escapeHtml(campaign.end_date || '')}"
                style="font-family:inherit;font-size:0.8rem;padding:0.2rem 0.4rem;border:2px solid #000;border-radius:4px;">
            </label>
          </div>

          ${products.length ? `
            <div class="parse-products-preview">
              ${products.map((product) => `
                <div class="parse-product-item">• ${escapeHtml(product.name.substring(0, 70))}</div>
              `).join('')}
              ${campaign.products.length > products.length
                ? `<div class="parse-product-more">+${campaign.products.length - products.length} sản phẩm khác</div>`
                : ''}
            </div>` : '<div class="parse-no-products">⚠️ Không tìm thấy sản phẩm với link affiliate</div>'}
        </div>
      </div>
    </div>
  `;
}

function bindPreviewEvents() {
  if (previewEventsBound) return;

  const previewEl = document.getElementById('parsePreview');
  if (!previewEl) return;

  previewEventsBound = true;

  previewEl.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-field]');
    if (!input) return;

    const idx = Number(input.dataset.idx);
    const campaign = parsedCampaigns[idx];
    if (!campaign) return;

    campaign[input.dataset.field] = input.value || null;
    updatePublishButtonState();
  });
}

function updatePublishButtonState() {
  const publishBtn = document.getElementById('publishAllBtn');
  if (!publishBtn) return;

  publishBtn.disabled = parsedCampaigns.length === 0;
  publishBtn.textContent = `✅ Publish ${parsedCampaigns.length} Campaign`;
}

/* ── Publish ──────────────────────────────────────────────────────────────── */

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateParsedCampaigns() {
  const problems = [];

  parsedCampaigns.forEach((campaign, idx) => {
    const label = `#${idx + 1} "${String(campaign.title || '').slice(0, 30)}"`;

    if (!campaign.title || campaign.title.length < 3) {
      problems.push(`${label}: thiếu tiêu đề`);
    }
    if (campaign.start_date && !isIsoDate(campaign.start_date)) {
      problems.push(`${label}: ngày bắt đầu không hợp lệ (${campaign.start_date})`);
    }
    if (campaign.end_date && !isIsoDate(campaign.end_date)) {
      problems.push(`${label}: ngày kết thúc không hợp lệ (${campaign.end_date})`);
    }
    if (isIsoDate(campaign.start_date) && isIsoDate(campaign.end_date)
      && campaign.end_date < campaign.start_date) {
      problems.push(`${label}: ngày kết thúc trước ngày bắt đầu`);
    }
    if (!Array.isArray(campaign.products)) {
      problems.push(`${label}: danh sách sản phẩm bị lỗi`);
    }
  });

  return problems;
}

/** Khoá nhận diện 1 campaign giữa các lần publish (title + ngày). */
function campaignKeyOf(campaign) {
  return [
    campaign.title || '',
    campaign.start_date || '',
    campaign.end_date || ''
  ].join('|');
}

async function publishAllCampaigns() {
  if (!parsedCampaigns.length) {
    showToast('⚠️ Chưa có campaign nào để publish!');
    return;
  }

  const problems = validateParsedCampaigns();
  const progressEl = document.getElementById('publishProgress');

  if (problems.length) {
    if (progressEl) progressEl.textContent = problems.join(' · ');
    showToast(`⚠️ ${problems[0]}`);
    return;
  }

  const publishBtn = document.getElementById('publishAllBtn');
  const originalText = publishBtn ? publishBtn.textContent : '';
  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.innerHTML = '<div class="spinner" style="display:inline-block;margin-right:8px"></div>Đang upload...';
  }

  let successCount = 0;
  let skippedCount = 0;
  const failures = [];
  const failedCampaigns = [];

  for (let i = 0; i < parsedCampaigns.length; i++) {
    const campaign = parsedCampaigns[i];
    const campaignKey = campaignKeyOf(campaign);

    // Đã publish trong phiên này → bỏ qua, không tạo bản trùng
    if (publishedCampaignKeys.has(campaignKey)) {
      skippedCount++;
      continue;
    }

    if (progressEl) {
      progressEl.textContent = `Đang upload campaign ${i + 1}/${parsedCampaigns.length}: ${campaign.title.substring(0, 40)}...`;
    }

    let createdCampaignId = null;

    try {
      const { data: campaignData, error: campaignError } = await supabaseClient
        .from('deal_campaigns')
        .insert({
          title: campaign.title,
          brand: campaign.brand || null,
          category: campaign.category || 'Khác',
          start_date: campaign.start_date || null,
          end_date: campaign.end_date || null,
          highlights: campaign.highlights,
          voucher_codes: campaign.voucher_codes,
          store_url: campaign.store_url || null,
          raw_content: campaign.raw_content,
          is_active: true,
          sort_order: i
        })
        .select('id')
        .single();

      if (campaignError) throw campaignError;
      createdCampaignId = campaignData.id;

      if (campaign.products.length) {
        const productsToInsert = campaign.products.map((product, productIndex) => ({
          campaign_id: createdCampaignId,
          name: product.name,
          description: product.description || null,
          affiliate_url: product.affiliate_url,
          discount_label: product.discount_label || null,
          has_gift: Boolean(product.has_gift),
          gift_description: product.gift_description || null,
          sort_order: productIndex
        }));

        const { error: productError } = await supabaseClient
          .from('deal_products')
          .insert(productsToInsert);

        // Không nuốt lỗi nữa: sản phẩm fail thì rollback cả campaign
        if (productError) throw new Error(`lỗi lưu sản phẩm: ${productError.message}`);
      }

      publishedCampaignKeys.add(campaignKey);
      successCount++;
    } catch (err) {
      console.error(`Lỗi publish campaign "${campaign.title}":`, err);
      failures.push(`#${i + 1}: ${err.message || err}`);
      failedCampaigns.push(campaign);

      if (createdCampaignId) {
        const { error: rollbackError } = await supabaseClient
          .from('deal_campaigns')
          .delete()
          .eq('id', createdCampaignId);
        if (rollbackError) {
          console.error('Không rollback được campaign:', rollbackError);
        }
      }
    }
  }

  if (publishBtn) {
    publishBtn.textContent = originalText;
    publishBtn.disabled = false;
  }

  if (!failures.length) {
    if (progressEl) progressEl.textContent = '';
    showToast(skippedCount
      ? `🎉 Publish ${successCount} campaign, bỏ qua ${skippedCount} campaign đã publish trước đó.`
      : `🎉 Đã publish ${successCount} campaign thành công!`);

    // Chỉ reset khi thành công 100%
    parsedCampaigns = [];
    const textarea = document.getElementById('dealRawContent');
    const previewSection = document.getElementById('parsePreviewSection');
    if (textarea) textarea.value = '';
    if (previewSection) previewSection.style.display = 'none';
  } else {
    // Chỉ giữ lại campaign LỖI → publish lại không tạo bản trùng cho campaign đã OK
    parsedCampaigns = failedCampaigns;
    renderParsePreview();

    if (progressEl) progressEl.textContent = `❌ ${failures.join(' · ')}`;
    const skippedMsg = skippedCount ? `, bỏ qua ${skippedCount} campaign đã publish trước đó` : '';
    showToast(`✅ ${successCount} thành công, ❌ ${failures.length} lỗi${skippedMsg} — preview chỉ còn campaign lỗi.`);
  }

  await loadExistingCampaigns();
}

/* ── Dialog xác nhận ─────────────────────────────────────────────────────── */

/**
 * Thay confirm() của browser bằng <dialog class="payout-dialog"> (AGENTS.md §3.3).
 * @param {string} message
 * @param {{title?: string, confirmLabel?: string, danger?: boolean}} [options]
 * @returns {Promise<boolean>}
 */
function adminConfirm(message, options = {}) {
  const { title = 'Xác nhận', confirmLabel = 'Đồng ý', danger = false } = options;

  const dialog = document.getElementById('adminConfirmDialog');
  const messageEl = document.getElementById('adminConfirmMessage');
  const titleEl = document.getElementById('adminConfirmTitle');
  const okBtn = document.getElementById('adminConfirmOk');
  const cancelBtn = document.getElementById('adminConfirmCancel');
  const closeBtn = document.getElementById('adminConfirmClose');

  // Fallback nếu HTML chưa có dialog (VD: bản cache cũ)
  if (!dialog || !messageEl || !okBtn || !cancelBtn) {
    return Promise.resolve(window.confirm(message));
  }

  return new Promise((resolve) => {
    let settled = false;

    function onOk() { settle(true); }
    function onCancel() { settle(false); }
    function onDialogCancel(event) {
      event.preventDefault();
      settle(false);
    }
    function onBackdrop(event) {
      if (event.target === dialog) settle(false);
    }

    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      if (closeBtn) closeBtn.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onDialogCancel);
      dialog.removeEventListener('click', onBackdrop);
    }

    function settle(value) {
      if (settled) return;
      settled = true;
      cleanup();

      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.classList.remove('show');

      resolve(value);
    }

    if (titleEl) titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = confirmLabel;
    okBtn.className = danger ? 'admin-btn-danger' : 'admin-btn-publish';

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    if (closeBtn) closeBtn.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onDialogCancel);
    dialog.addEventListener('click', onBackdrop);

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.classList.add('show');
  });
}

/* ── Thao tác trên campaign ───────────────────────────────────────────────── */

async function toggleCampaignActive(id, isActive) {
  const { error } = await supabaseClient
    .from('deal_campaigns')
    .update({ is_active: isActive })
    .eq('id', id);

  if (error) {
    showToast('❌ Lỗi cập nhật: ' + error.message);
    return;
  }

  showToast(isActive ? '✅ Đã bật campaign' : '⏸ Đã ẩn campaign');
  await loadExistingCampaigns();
}

async function deleteCampaign(id, title) {
  const confirmed = await adminConfirm(
    `Xóa campaign "${title}"?\n\nHành động này không thể hoàn tác!`,
    { title: 'Xóa campaign', confirmLabel: 'Xóa', danger: true }
  );

  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('deal_campaigns')
    .delete()
    .eq('id', id);

  if (error) {
    showToast('❌ Lỗi xóa: ' + error.message);
    return;
  }

  showToast('🗑️ Đã xóa campaign!');
  await loadExistingCampaigns();
}

/* ── Event delegation ─────────────────────────────────────────────────────── */

function bindAdminUi() {
  if (existingEventsBound) return;

  const listEl = document.getElementById('existingCampaignsList');
  if (!listEl) return;

  existingEventsBound = true;

  listEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const { action, id } = button.dataset;

    if (action === 'delete') {
      deleteCampaign(id, button.dataset.title || '');
      return;
    }

    if (action === 'toggle') {
      toggleCampaignActive(id, button.dataset.next === '1');
    }
  });
}

/* ── Lỗi truy cập ─────────────────────────────────────────────────────────── */

function showAdminError(msg) {
  const el = document.getElementById('adminLoginSection');
  if (!el) return;

  el.style.display = 'flex';
  el.innerHTML = `
    <div class="admin-login-card">
      <div class="admin-login-icon">🚫</div>
      <div class="admin-login-title" style="color:var(--orange);">Từ chối truy cập</div>
      <div class="admin-login-sub">${escapeHtml(msg)}</div>
      <button class="btn-convert" onclick="signOut()" style="width:100%; justify-content:center; margin-top:1rem;">
        Đăng xuất / Đổi tài khoản
      </button>
    </div>
  `;

  const mainSection = document.getElementById('adminMainSection');
  if (mainSection) mainSection.style.display = 'none';
}

/* ── Bootstrap ────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  if (!supabaseClient) return;

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session) {
      initAdminDeals();
      return;
    }

    adminReady = false;
    const loginSection = document.getElementById('adminLoginSection');
    const mainSection = document.getElementById('adminMainSection');
    if (loginSection) loginSection.style.display = 'flex';
    if (mainSection) mainSection.style.display = 'none';
  });

  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session) initAdminDeals();
  });
});
