/**
 * withdrawal.js — Xử lý logic Rút tiền
 *
 * Quy tắc tính tiền:
 *  - Chỉ tính các đơn hàng có status = 'approved' (tương ứng "Hoàn thành" trong DB)
 *  - Số tiền user nhận = tổng net_commission của các đơn đó / 2 (50% hoa hồng)
 *  - Khi user đã từng rút, các order_id đã được ghi nhận trong bảng withdrawal_requests
 *    sẽ KHÔNG được tính lại (tránh chia nhầm hoa hồng)
 *  - Chỉ tính thêm những đơn chưa nằm trong bất kỳ withdrawal request nào của user
 */

// ─── Trạng thái nội bộ ───────────────────────────────────────────────────────
let _withdrawEligibleOrders = [];   // Đơn Hoàn thành chưa rút
let _withdrawAlreadyAmount = 0;    // Số tiền đã rút trước đó (50% của tổng cũ)
let _withdrawAvailableNet = 0;    // Net commission chưa rút (để tính 50%)
let _withdrawBonusBalance = 0;    // Số dư bonus (signup bonus + khuyến mãi)
let _withdrawOrdersMap = new Map(); // Cache tất cả đơn hàng theo ID để xem chi tiết lịch sử

const WITHDRAW_MINIMUM_AMOUNT = 50000; // Tối thiểu 50.000đ mới được rút

// ─── Mở / Đóng modal ─────────────────────────────────────────────────────────
async function openWithdrawModal() {
  const modal = document.getElementById('withdrawModal');
  if (!modal) return;

  if (typeof modal.showModal === 'function') {
    modal.showModal();
  } else {
    modal.classList.add('show');
  }

  clearWithdrawStatus();
  resetWithdrawSubmitBtn();
  await loadWithdrawData();
}

function closeWithdrawModal() {
  const modal = document.getElementById('withdrawModal');
  if (!modal) return;
  if (typeof modal.close === 'function') {
    modal.close();
  } else {
    modal.classList.remove('show');
  }
}

window.addEventListener('click', (event) => {
  const modal = document.getElementById('withdrawModal');
  if (event.target === modal) closeWithdrawModal();
});

// ─── Tải & tính toán dữ liệu ─────────────────────────────────────────────────
async function loadWithdrawData() {
  if (!supabaseClient || !currentUser) return;

  setWithdrawLoading(true);

  try {
    // 1. Lấy bonus_balance từ profile của user
    const { data: profileData, error: profileError } = await supabaseClient
      .from('profiles')
      .select('bonus_balance')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (profileError) throw profileError;
    _withdrawBonusBalance = Number(profileData?.bonus_balance || 0);

    // 2. Lấy đơn hàng của user (để tính đơn chưa rút và hiển thị chi tiết lịch sử rút)
    const { data: userOrders, error: ordersError } = await supabaseClient
      .from('orders')
      .select('id, shopee_order_id, item_name, net_commission, purchase_time, completed_at, status')
      .eq('user_id', currentUser.id);

    if (ordersError) throw ordersError;

    const allUserOrders = userOrders || [];
    _withdrawOrdersMap = new Map(allUserOrders.map(o => [o.id, o]));

    // Chỉ tính các đơn có status = 'approved' cho đợt rút mới
    const allApproved = allUserOrders.filter(o => o.status === 'approved');

    // 3. Lấy toàn bộ lịch sử rút tiền đã được ghi nhận (kể cả pending)
    const { data: withdrawals, error: withdrawError } = await supabaseClient
      .from('withdrawal_requests')
      .select('id, amount, total_net_commission, order_ids, status, created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (withdrawError) throw withdrawError;

    const allWithdrawals = withdrawals || [];

    // Kiểm tra xem có order_ids nào trong lịch sử rút tiền chưa có trong cache không
    const missingOrderIds = [];
    allWithdrawals.forEach(w => {
      (w.order_ids || []).forEach(oid => {
        if (!_withdrawOrdersMap.has(oid)) {
          missingOrderIds.push(oid);
        }
      });
    });

    if (missingOrderIds.length > 0) {
      const { data: extraOrders } = await supabaseClient
        .from('orders')
        .select('id, shopee_order_id, item_name, net_commission, purchase_time, completed_at, status')
        .in('id', missingOrderIds);

      if (extraOrders) {
        extraOrders.forEach(o => _withdrawOrdersMap.set(o.id, o));
      }
    }

    // 4. Thu thập tập hợp các order_id đã được tính vào withdrawal trước đó
    //    (bất kỳ trạng thái nào — kể cả pending — để tránh tính trùng)
    const alreadyWithdrawnOrderIds = new Set();
    let totalAlreadyWithdrawnNet = 0;

    allWithdrawals.forEach(w => {
      // Chỉ tính các lần rút KHÔNG bị rejected
      if (w.status !== 'rejected') {
        (w.order_ids || []).forEach(oid => alreadyWithdrawnOrderIds.add(oid));
        totalAlreadyWithdrawnNet += Number(w.total_net_commission || 0);
      }
    });

    // Số tiền đã rút (50% của tổng net đã rút)
    _withdrawAlreadyAmount = totalAlreadyWithdrawnNet / 2;

    // 5. Tách đơn chưa rút
    _withdrawEligibleOrders = allApproved.filter(o => !alreadyWithdrawnOrderIds.has(o.id));

    // 6. Tính net chưa rút và số tiền user sẽ nhận từ commission
    _withdrawAvailableNet = _withdrawEligibleOrders.reduce(
      (sum, o) => sum + Number(o.net_commission || 0), 0
    );
    const commissionForUser = _withdrawAvailableNet / 2;

    // 7. Tổng số dư user có thể rút = commission + bonus
    const totalAvailableForUser = commissionForUser + _withdrawBonusBalance;

    // 8. Cập nhật UI summary
    const fmt = formatCurrency;
    setWithdrawSummary({
      eligibleCount: _withdrawEligibleOrders.length,
      totalNet: fmt(_withdrawAvailableNet),
      available: fmt(totalAvailableForUser),
      bonusBalance: fmt(_withdrawBonusBalance),
      hasBonus: _withdrawBonusBalance > 0,
      totalAvailable: totalAvailableForUser,
      meetsMinimum: totalAvailableForUser >= WITHDRAW_MINIMUM_AMOUNT
    });

    // 9. Render danh sách đơn đủ điều kiện
    renderWithdrawOrders(_withdrawEligibleOrders);

    // 10. Render lịch sử rút tiền
    renderWithdrawHistory(allWithdrawals);

  } catch (err) {
    console.error('loadWithdrawData error:', err);
    showWithdrawStatus('Không tải được dữ liệu rút tiền: ' + (err.message || ''), 'error');
  } finally {
    setWithdrawLoading(false);
  }
}

// ─── Cập nhật UI Summary ─────────────────────────────────────────────────────
function setWithdrawSummary({ eligibleCount, totalNet, available, bonusBalance, hasBonus, totalAvailable, meetsMinimum }) {
  setElText('withdrawEligibleCount', `${eligibleCount} đơn`);
  setElText('withdrawTotalNet', totalNet);
  setElText('withdrawAvailable', available);

  // Hiển thị dòng bonus nếu có
  const bonusRow = document.getElementById('withdrawBonusRow');
  const bonusEl = document.getElementById('withdrawBonusAmount');
  if (bonusRow) bonusRow.style.display = hasBonus ? 'flex' : 'none';
  if (bonusEl) bonusEl.textContent = bonusBalance;

  // Hiển thị cảnh báo nếu chưa đạt ngưỡng tối thiểu
  const minWarnEl = document.getElementById('withdrawMinWarning');
  if (minWarnEl) {
    if (!meetsMinimum && totalAvailable > 0) {
      minWarnEl.textContent = `Cần ít nhất 50.000đ để rút tiền. Hiện tại bạn có ${formatCurrency(totalAvailable)}.`;
      minWarnEl.style.display = 'block';
    } else if (!meetsMinimum && totalAvailable <= 0) {
      minWarnEl.textContent = 'Chưa có số dư để rút tiền.';
      minWarnEl.style.display = 'block';
    } else {
      minWarnEl.style.display = 'none';
    }
  }

  const btn = document.getElementById('btnDoWithdraw');
  if (btn) btn.disabled = !meetsMinimum;
}

// ─── Render danh sách đơn đủ điều kiện ──────────────────────────────────────
function renderWithdrawOrders(orders) {
  const listEl = document.getElementById('withdrawOrdersList');
  if (!listEl) return;

  if (!orders.length) {
    listEl.innerHTML = '<div class="history-empty">Không có đơn mới nào đủ điều kiện rút tiền.</div>';
    return;
  }

  listEl.innerHTML = orders.map(order => {
    const name = escapeHtml(order.item_name || 'Đơn hàng Shopee');
    const orderId = escapeHtml(order.shopee_order_id || '--');
    const net = formatCurrency(order.net_commission);
    const userShare = formatCurrency(Number(order.net_commission || 0) / 2);
    const time = order.purchase_time
      ? new Date(order.purchase_time).toLocaleDateString('vi-VN')
      : (order.completed_at ? new Date(order.completed_at).toLocaleDateString('vi-VN') : '--');

    return `
      <div class="withdraw-order-item">
        <div class="withdraw-order-info">
          <span class="withdraw-order-name" title="${name}">${name}</span>
          <span class="withdraw-order-meta">Mã: ${orderId} | ${time}</span>
        </div>
        <div class="withdraw-order-right">
          <span class="withdraw-order-net">Net: ${escapeHtml(net)}</span>
          <span class="withdraw-order-share">Bạn nhận: <strong>${escapeHtml(userShare)}</strong></span>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Render lịch sử rút tiền ─────────────────────────────────────────────────
function renderWithdrawHistory(withdrawals) {
  const listEl = document.getElementById('withdrawHistoryList');
  if (!listEl) return;

  if (!withdrawals.length) {
    listEl.innerHTML = '<div class="history-empty">Chưa có lịch sử rút tiền.</div>';
    return;
  }

  const statusMap = {
    pending: { label: 'Chờ xử lý', cls: 'wr-pending' },
    processing: { label: 'Đang xử lý', cls: 'wr-processing' },
    completed: { label: 'Đã hoàn tất', cls: 'wr-completed' },
    rejected: { label: 'Bị từ chối', cls: 'wr-rejected' }
  };

  listEl.innerHTML = withdrawals.map(w => {
    const meta = statusMap[w.status] || { label: w.status, cls: 'wr-pending' };
    const date = new Date(w.created_at).toLocaleString('vi-VN');
    const amount = formatCurrency(w.amount);
    const orderIds = Array.isArray(w.order_ids) ? w.order_ids : [];
    const orderCount = orderIds.length;

    return `
      <div class="withdraw-history-item" id="wh-item-${w.id}">
        <div class="withdraw-history-summary"
             onclick="toggleWithdrawHistoryDetail('${w.id}')"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleWithdrawHistoryDetail('${w.id}');}"
             role="button"
             tabindex="0"
             aria-expanded="false"
             title="Nhấn để xem chi tiết ${orderCount} đơn hàng">
          <div class="wh-left">
            <span class="wh-date">${escapeHtml(date)}</span>
            <span class="wh-orders">
              ${orderCount} đơn hàng
              <span class="wh-expand-hint" id="wh-hint-${w.id}">• Xem chi tiết ▾</span>
            </span>
          </div>
          <div class="wh-right">
            <span class="wh-amount">${escapeHtml(amount)}</span>
            <div class="wh-status-wrap">
              <span class="wh-status ${meta.cls}">${meta.label}</span>
              <span class="wh-chevron" id="wh-chevron-${w.id}" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </span>
            </div>
          </div>
        </div>
        <div class="withdraw-history-detail" id="wh-detail-${w.id}" style="display: none;">
          ${renderWithdrawDetailOrdersHtml(w, orderIds)}
        </div>
      </div>
    `;
  }).join('');
}

// ─── Render chi tiết các đơn hàng trong 1 lần rút tiền ───────────────────────
function renderWithdrawDetailOrdersHtml(withdrawal, orderIds) {
  if (!orderIds || !orderIds.length) {
    return `
      <div class="wh-detail-empty">
        Không có đơn hàng cụ thể (đợt rút từ số dư thưởng / khuyến mãi).
      </div>
    `;
  }

  let totalCalculatedUserShare = 0;

  const ordersListHtml = orderIds.map((orderId, idx) => {
    const order = _withdrawOrdersMap.get(orderId);
    if (!order) {
      return `
        <div class="wh-suborder-card">
          <div class="wh-suborder-top">
            <span class="wh-suborder-name"><span class="wh-order-num">#${idx + 1}</span> Đơn hàng</span>
            <span class="wh-suborder-share">--</span>
          </div>
          <div class="wh-suborder-bottom">
            <div class="wh-suborder-meta">
              <span class="wh-meta-tag">Mã đơn: <strong>${escapeHtml(orderId)}</strong></span>
            </div>
            <span class="wh-suborder-badge is-approved">Đã rút</span>
          </div>
        </div>
      `;
    }

    const name = order.item_name || 'Đơn hàng Shopee';
    const orderCode = order.shopee_order_id || '--';
    const netComm = Number(order.net_commission || 0);
    const userShare = netComm / 2;
    totalCalculatedUserShare += userShare;

    const timeStr = order.purchase_time
      ? new Date(order.purchase_time).toLocaleDateString('vi-VN')
      : (order.completed_at ? new Date(order.completed_at).toLocaleDateString('vi-VN') : '--');

    const statusMeta = getOrderStatusMeta(order.status || 'approved');

    return `
      <div class="wh-suborder-card">
        <div class="wh-suborder-top">
          <span class="wh-suborder-name" title="${escapeHtml(name)}">
            <span class="wh-order-num">#${idx + 1}</span> ${escapeHtml(name)}
          </span>
          <div class="wh-suborder-share-col">
            <span class="wh-suborder-share">+${formatCurrency(userShare)}</span>
            <span class="wh-suborder-share-sub">Hoàn 50%</span>
          </div>
        </div>
        <div class="wh-suborder-bottom">
          <div class="wh-suborder-meta">
            <span class="wh-meta-tag">Mã: <strong>${escapeHtml(orderCode)}</strong></span>
            <span class="wh-meta-divider">•</span>
            <span class="wh-meta-tag">${timeStr}</span>
            <span class="wh-meta-divider">•</span>
            <span class="wh-meta-tag">Net: ${formatCurrency(netComm)}</span>
          </div>
          <span class="wh-suborder-badge ${statusMeta.className}">${statusMeta.label}</span>
        </div>
      </div>
    `;
  }).join('');

  const totalAmount = Number(withdrawal.amount || 0);
  const bonusDifference = totalAmount - totalCalculatedUserShare;
  let bonusHtml = '';

  if (bonusDifference > 1) { // Lớn hơn 1 đồng để tránh sai số làm tròn số thực
    bonusHtml = `
      <div class="wh-suborder-bonus">
        <div class="wh-suborder-bonus-left">
          <span>🎁 Tiền thưởng bonus / khuyến mãi:</span>
        </div>
        <div class="wh-suborder-bonus-right">
          <strong>+${formatCurrency(bonusDifference)}</strong>
        </div>
      </div>
    `;
  }

  return `
    <div class="wh-detail-box">
      <div class="wh-detail-heading">
        <span>📦 Chi tiết ${orderIds.length} đơn hàng được hoàn tiền:</span>
      </div>
      <div class="wh-suborders-list">
        ${ordersListHtml}
      </div>
      ${bonusHtml}
      <div class="wh-detail-footer">
        <span class="wh-footer-label">Tổng nhận lần rút này (${orderIds.length} đơn):</span>
        <strong class="wh-footer-amount">${formatCurrency(totalAmount)}</strong>
      </div>
    </div>
  `;
}

// ─── Đóng / Mở chi tiết 1 lần rút tiền (Accordion) ───────────────────────────
function toggleWithdrawHistoryDetail(id) {
  const itemEl = document.getElementById(`wh-item-${id}`);
  const detailEl = document.getElementById(`wh-detail-${id}`);
  const chevronEl = document.getElementById(`wh-chevron-${id}`);
  const hintEl = document.getElementById(`wh-hint-${id}`);
  const summaryEl = itemEl?.querySelector('.withdraw-history-summary');
  if (!detailEl || !itemEl) return;

  const isHidden = detailEl.style.display === 'none';

  // Đóng các lần rút khác đang mở để tránh danh sách quá dài gây khó cuộn
  document.querySelectorAll('.withdraw-history-item').forEach(otherItem => {
    if (otherItem.id !== `wh-item-${id}`) {
      otherItem.classList.remove('is-expanded');
      const otherDetail = otherItem.querySelector('.withdraw-history-detail');
      const otherChevron = otherItem.querySelector('.wh-chevron');
      const otherHint = otherItem.querySelector('.wh-expand-hint');
      const otherSummary = otherItem.querySelector('.withdraw-history-summary');
      if (otherDetail) otherDetail.style.display = 'none';
      if (otherChevron) otherChevron.classList.remove('is-rotated');
      if (otherHint) otherHint.textContent = '• Xem chi tiết ▾';
      if (otherSummary) otherSummary.setAttribute('aria-expanded', 'false');
    }
  });

  if (isHidden) {
    detailEl.style.display = 'block';
    itemEl.classList.add('is-expanded');
    if (chevronEl) chevronEl.classList.add('is-rotated');
    if (hintEl) hintEl.textContent = '• Thu gọn ▴';
    if (summaryEl) summaryEl.setAttribute('aria-expanded', 'true');

    // Tự động cuộn mượt để đưa chi tiết đơn hàng vào vùng nhìn thấy của dialog
    setTimeout(() => {
      itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  } else {
    detailEl.style.display = 'none';
    itemEl.classList.remove('is-expanded');
    if (chevronEl) chevronEl.classList.remove('is-rotated');
    if (hintEl) hintEl.textContent = '• Xem chi tiết ▾';
    if (summaryEl) summaryEl.setAttribute('aria-expanded', 'false');
  }
}

// ─── Gửi yêu cầu rút tiền ────────────────────────────────────────────────────
async function submitWithdrawRequest() {
  if (!supabaseClient || !currentUser) {
    showWithdrawStatus('Vui lòng đăng nhập trước.', 'error');
    return;
  }

  const commissionForUser = _withdrawAvailableNet / 2;
  const totalAvailableForUser = commissionForUser + _withdrawBonusBalance;

  // Validate: phải có ít nhất 50.000đ
  if (totalAvailableForUser < WITHDRAW_MINIMUM_AMOUNT) {
    showWithdrawStatus(
      `Cần ít nhất ${formatCurrency(WITHDRAW_MINIMUM_AMOUNT)} để rút tiền. Hiện tại bạn có ${formatCurrency(totalAvailableForUser)}.`,
      'error'
    );
    return;
  }

  setWithdrawSubmitting(true);
  clearWithdrawStatus();

  try {
    // Snapshot các order_id để ghi vào DB — tránh race condition
    const orderIds = _withdrawEligibleOrders.map(o => o.id);

    const { error } = await supabaseClient
      .from('withdrawal_requests')
      .insert({
        user_id: currentUser.id,
        amount: totalAvailableForUser,
        total_net_commission: _withdrawAvailableNet,
        order_ids: orderIds,
        status: 'pending'
      });

    if (error) throw error;

    // Reset bonus_balance về 0 sau khi đã gộp vào lần rút này
    // Nếu không reset, lần rút tiếp theo sẽ cộng bonus lần nữa (bug double-count)
    if (_withdrawBonusBalance > 0) {
      const { error: bonusResetError } = await supabaseClient
        .from('profiles')
        .update({ bonus_balance: 0 })
        .eq('id', currentUser.id);

      if (bonusResetError) {
        console.error('Không thể reset bonus_balance:', bonusResetError);
        // Không throw — withdrawal đã được tạo thành công, lỗi phụ không nên block UX
      }
    }

    showWithdrawStatus(
      `✅ Đã gửi yêu cầu rút ${formatCurrency(totalAvailableForUser)} thành công! Admin sẽ xử lý sớm.`,
      'success'
    );

    // Reload dữ liệu để phản ánh trạng thái mới
    setTimeout(() => loadWithdrawData(), 1000);

  } catch (err) {
    console.error('submitWithdrawRequest error:', err);
    showWithdrawStatus('Gửi yêu cầu thất bại: ' + (err.message || 'Lỗi không xác định'), 'error');
  } finally {
    setWithdrawSubmitting(false);
  }
}

// ─── Helpers UI ──────────────────────────────────────────────────────────────
function setElText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setWithdrawLoading(isLoading) {
  const ordersEl = document.getElementById('withdrawOrdersList');
  const historyEl = document.getElementById('withdrawHistoryList');
  if (isLoading) {
    if (ordersEl) ordersEl.innerHTML = '<div class="history-empty">Đang tải...</div>';
    if (historyEl) historyEl.innerHTML = '<div class="history-empty">Đang tải...</div>';
  }
}

function setWithdrawSubmitting(isSending) {
  const btn = document.getElementById('btnDoWithdraw');
  const label = document.getElementById('withdrawBtnLabel');
  const spinner = document.getElementById('withdrawSpinner');
  if (btn) btn.disabled = isSending;
  if (label) label.textContent = isSending ? 'Đang gửi...' : 'Gửi yêu cầu rút tiền';
  if (spinner) spinner.style.display = isSending ? 'block' : 'none';
}

function resetWithdrawSubmitBtn() {
  setWithdrawSubmitting(false);
}

function showWithdrawStatus(message, type) {
  const el = document.getElementById('withdrawStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `withdraw-status show ${type}`;
}

function clearWithdrawStatus() {
  const el = document.getElementById('withdrawStatus');
  if (!el) return;
  el.textContent = '';
  el.className = 'withdraw-status';
}
