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
let _withdrawAlreadyAmount  = 0;    // Số tiền đã rút trước đó (50% của tổng cũ)
let _withdrawAvailableNet   = 0;    // Net commission chưa rút (để tính 50%)

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
    // 1. Lấy TẤT CẢ đơn "approved" (Hoàn thành) của user
    const { data: approvedOrders, error: ordersError } = await supabaseClient
      .from('orders')
      .select('id, shopee_order_id, item_name, net_commission, purchase_time, completed_at, status')
      .eq('user_id', currentUser.id)
      .eq('status', 'approved');

    if (ordersError) throw ordersError;

    const allApproved = approvedOrders || [];

    // 2. Lấy toàn bộ lịch sử rút tiền đã được ghi nhận (kể cả pending)
    const { data: withdrawals, error: withdrawError } = await supabaseClient
      .from('withdrawal_requests')
      .select('id, amount, total_net_commission, order_ids, status, created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (withdrawError) throw withdrawError;

    const allWithdrawals = withdrawals || [];

    // 3. Thu thập tập hợp các order_id đã được tính vào withdrawal trước đó
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

    // 4. Tách đơn chưa rút
    _withdrawEligibleOrders = allApproved.filter(o => !alreadyWithdrawnOrderIds.has(o.id));

    // 5. Tính net chưa rút và số tiền user sẽ nhận
    _withdrawAvailableNet = _withdrawEligibleOrders.reduce(
      (sum, o) => sum + Number(o.net_commission || 0), 0
    );
    const availableForUser = _withdrawAvailableNet / 2;

    // Tổng net tất cả đơn approved (để hiển thị)
    const totalNetAllApproved = allApproved.reduce(
      (sum, o) => sum + Number(o.net_commission || 0), 0
    );

    // 6. Cập nhật UI summary
    const fmt = formatCurrency;
    setWithdrawSummary({
      eligibleCount: _withdrawEligibleOrders.length,
      totalNet: fmt(_withdrawAvailableNet),
      available: fmt(availableForUser),
      hasAvailable: availableForUser > 0
    });

    // 7. Render danh sách đơn đủ điều kiện
    renderWithdrawOrders(_withdrawEligibleOrders);

    // 8. Render lịch sử rút tiền
    renderWithdrawHistory(allWithdrawals);

  } catch (err) {
    console.error('loadWithdrawData error:', err);
    showWithdrawStatus('Không tải được dữ liệu rút tiền: ' + (err.message || ''), 'error');
  } finally {
    setWithdrawLoading(false);
  }
}

// ─── Cập nhật UI Summary ─────────────────────────────────────────────────────
function setWithdrawSummary({ eligibleCount, totalNet, available, hasAvailable }) {
  setElText('withdrawEligibleCount', `${eligibleCount} đơn`);
  setElText('withdrawTotalNet', totalNet);
  setElText('withdrawAvailable', available);

  const btn = document.getElementById('btnDoWithdraw');
  if (btn) btn.disabled = !hasAvailable;
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
    pending:    { label: 'Chờ xử lý',  cls: 'wr-pending' },
    processing: { label: 'Đang xử lý', cls: 'wr-processing' },
    completed:  { label: 'Đã hoàn tất', cls: 'wr-completed' },
    rejected:   { label: 'Bị từ chối', cls: 'wr-rejected' }
  };

  listEl.innerHTML = withdrawals.map(w => {
    const meta = statusMap[w.status] || { label: w.status, cls: 'wr-pending' };
    const date = new Date(w.created_at).toLocaleString('vi-VN');
    const amount = formatCurrency(w.amount);
    const orderCount = (w.order_ids || []).length;

    return `
      <div class="withdraw-history-item">
        <div class="wh-left">
          <span class="wh-date">${escapeHtml(date)}</span>
          <span class="wh-orders">${orderCount} đơn hàng</span>
        </div>
        <div class="wh-right">
          <span class="wh-amount">${escapeHtml(amount)}</span>
          <span class="wh-status ${meta.cls}">${meta.label}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Gửi yêu cầu rút tiền ────────────────────────────────────────────────────
async function submitWithdrawRequest() {
  if (!supabaseClient || !currentUser) {
    showWithdrawStatus('Vui lòng đăng nhập trước.', 'error');
    return;
  }

  if (!_withdrawEligibleOrders.length) {
    showWithdrawStatus('Không có đơn hàng nào đủ điều kiện rút tiền.', 'error');
    return;
  }

  const availableForUser = _withdrawAvailableNet / 2;
  if (availableForUser <= 0) {
    showWithdrawStatus('Số tiền có thể rút phải lớn hơn 0.', 'error');
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
        amount: availableForUser,
        total_net_commission: _withdrawAvailableNet,
        order_ids: orderIds,
        status: 'pending'
      });

    if (error) throw error;

    showWithdrawStatus(
      `✅ Đã gửi yêu cầu rút ${formatCurrency(availableForUser)} thành công! Admin sẽ xử lý sớm.`,
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
