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

/* ── REFERRAL DASHBOARD ── */
let isReferralLoaded = false;

async function loadReferralStats() {
  const panel = document.getElementById('referralPanel');
  if (!panel) return;

  if (!currentUser) {
    panel.innerHTML = '<div class="history-empty">Đăng nhập để xem thống kê giới thiệu.</div>';
    isReferralLoaded = false;
    return;
  }

  // Load once
  if (isReferralLoaded) return;

  try {
    panel.innerHTML = '<div class="history-empty">Đang tải thông tin... <div class="spinner" style="display:inline-block; border-color:var(--primary) transparent transparent transparent"></div></div>';

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error('No session');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/referral-stats`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to load stats: ${res.status} - ${errText}`);
    }

    const stats = await res.json();
    renderReferralDashboard(stats);
    isReferralLoaded = true;

  } catch (err) {
    console.error('Referral Stats Error:', err);
    panel.innerHTML = '<div class="history-empty" style="color:var(--error)">Không thể tải thông tin giới thiệu. Vui lòng thử lại sau.</div>';
  }
}

function renderReferralDashboard(stats) {
  const panel = document.getElementById('referralPanel');
  if (!panel) return;

  const refLink = `${window.location.origin}${window.location.pathname}?ref=${stats.referral_code || ''}`;
  const progressPercent = Math.min(100, Math.round((stats.monthly_rewarded / stats.monthly_limit) * 100));

  let html = `
    <div class="referral-header">
      <h3>🤝 Giới thiệu bạn bè</h3>
      <p>Bạn nhận <span class="ref-highlight">+5.000đ</span> — Bạn bè nhận <span class="ref-highlight">+2.000đ</span><br>mỗi khi bạn bè mua hàng thành công lần đầu!</p>
      
      <div class="referral-share-box">
        <!-- Card 1: Referral Code -->
        <div class="share-card code-card">
          <div class="share-card-header">
            <span class="share-card-title">Mã của bạn</span>
          </div>
          <div class="share-card-body">
            <div class="code-display-wrapper">
              <span class="code-display" id="refCodeText">${stats.referral_code || '---'}</span>
              <button class="btn-copy-ref" onclick="copyRefCode('${stats.referral_code}')">Copy Mã</button>
            </div>
          </div>
        </div>

        <!-- Card 2: Share Link -->
        <div class="share-card link-card">
          <div class="share-card-header">
            <span class="share-card-title">Link chia sẻ</span>
          </div>
          <div class="share-card-body">
            <div class="link-display-wrapper">
              <input type="text" class="ref-link-input" readonly value="${refLink}" id="refLinkInput" onclick="this.select()" />
              <button class="btn-copy-ref" onclick="copyRefLink('${refLink}')">Copy Link</button>
            </div>
          </div>
        </div>
      </div>

      <div class="referral-input-box">
        <div class="ref-input-title">🎁 Nhập mã giới thiệu của bạn bè</div>
        <div class="ref-input-group">
          <input type="text" id="manualRefCodeInput" class="ref-input" placeholder="VD: NHXLU5J" autocomplete="off" />
          <button class="btn-submit-ref" id="btnSubmitRef" onclick="submitReferralCode()">Xác nhận</button>
        </div>
      </div>

      <div class="referral-progress">
        <div class="progress-header">
          <span>Tiến độ tháng này</span>
          <span>${stats.monthly_rewarded} / ${stats.monthly_limit} lượt</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
        </div>
      </div>
    </div>

    <div class="referral-stats-row">
      <div class="stat-card">
        <div class="stat-val">${formatCurrency(stats.total_reward_earned)}</div>
        <div class="stat-label">Tổng tiền đã nhận</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${stats.total_rewarded}</div>
        <div class="stat-label">Người đã thưởng</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${stats.pending_count}</div>
        <div class="stat-label">Đang chờ mua hàng</div>
      </div>
    </div>

    <div class="referral-list-section">
      <div class="list-header">Danh sách bạn bè đã giới thiệu</div>
      <div class="ref-list">
  `;

  if (stats.referral_list && stats.referral_list.length > 0) {
    stats.referral_list.forEach(r => {
      let statusIcon, statusText, statusClass, earnText;

      if (r.status === 'rewarded') {
        statusIcon = '✅';
        statusText = 'Đã nhận thưởng';
        statusClass = 'status-rewarded';
        earnText = `+${formatCurrency(r.reward_earned)}`;
      } else if (r.status === 'clawed_back') {
        statusIcon = '⚠️';
        statusText = 'Đơn bị hoàn';
        statusClass = 'status-clawed';
        earnText = `-${formatCurrency(r.reward_earned)}`;
      } else {
        statusIcon = '⏳';
        statusText = 'Chờ mua hàng';
        statusClass = 'status-pending';
        earnText = '—';
      }

      const avatar = r.avatar_url || 'assets/images/logo.png';
      const date = new Date(r.joined_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

      html += `
        <div class="ref-item">
          <div class="ref-user">
            <img src="${avatar}" alt="Avatar" class="ref-avatar" onerror="this.src='assets/images/logo.png'">
            <div>
              <div class="ref-name">${r.full_name}</div>
              <div class="ref-date">Tham gia: ${date}</div>
            </div>
          </div>
          <div class="ref-status-box">
            <div class="ref-status ${statusClass}">${statusIcon} ${statusText}</div>
            <div class="ref-earn">${earnText}</div>
          </div>
        </div>
      `;
    });
  } else {
    html += `<div class="history-empty" style="padding: 2rem 0">Bạn chưa giới thiệu ai. Hãy chia sẻ link ngay nhé!</div>`;
  }

  html += `
      </div>
    </div>
  `;

  panel.innerHTML = html;
}

function copyRefCode(code) {
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    showToast('Đã copy mã giới thiệu!');
  });
}

function copyRefLink(link) {
  if (!link) return;
  navigator.clipboard.writeText(link).then(() => {
    if (typeof showToast === 'function') showToast('Đã copy link giới thiệu!');
    else alert('Đã copy link giới thiệu!');
  });
}

async function submitReferralCode() {
  const input = document.getElementById('manualRefCodeInput');
  const btn = document.getElementById('btnSubmitRef');
  const code = input.value.trim();

  if (!code) {
    if (typeof showToast === 'function') showToast('Vui lòng nhập mã giới thiệu!');
    else alert('Vui lòng nhập mã giới thiệu!');
    return;
  }

  btn.disabled = true;
  btn.innerText = 'Đang xử lý...';

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error('Chưa đăng nhập');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/apply-referral`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ referral_code: code })
    });

    const result = await res.json();

    if (res.ok && result.success) {
      if (typeof showToast === 'function') showToast('✅ Nhập mã thành công!');
      else alert('Nhập mã thành công!');
      input.value = '';
    } else {
      const errMsg = result.error || 'Lỗi không xác định';
      if (typeof showToast === 'function') showToast('❌ ' + errMsg);
      else alert('Lỗi: ' + errMsg);
    }
  } catch (err) {
    console.error(err);
    if (typeof showToast === 'function') showToast('❌ Có lỗi xảy ra, vui lòng thử lại sau.');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Xác nhận';
  }
}
