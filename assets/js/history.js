async function loadLinkHistory() {
  if (!supabaseClient || !currentUser) return;

  const historyList = document.getElementById('historyList');
  historyList.innerHTML = '<div class="history-empty">Đang tải lịch sử link...</div>';

  const { data, error } = await supabaseClient
    .from('affiliate_links')
    .select('id, sub_id, affiliate_url, normalized_url, estimated_commission, commission_rate, product_name, product_image, created_at')
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) {
    historyList.innerHTML = '<div class="history-empty">Không tải được lịch sử link. Hãy kiểm tra RLS/schema Supabase.</div>';
    console.error(error);
    return;
  }

  const links = data || [];
  const subIds = links.map(link => link.sub_id).filter(Boolean);
  const ordersBySubId = await loadOrdersBySubId(subIds);

  renderHistory(links.map(link => ({
    ...link,
    orders: ordersBySubId.get(link.sub_id) || []
  })));
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

async function loadOrdersBySubId(subIds) {
  const ordersBySubId = new Map();
  if (!subIds.length) return ordersBySubId;

  const { data, error } = await supabaseClient
    .from('orders')
    .select('id, shopee_order_id, sub_id, item_name, commission, net_commission, commission_rate, status, purchase_time, completed_at')
    .in('sub_id', subIds)
    .order('purchase_time', { ascending: false });

  if (error) {
    console.warn('Could not load orders for history:', error);
    return ordersBySubId;
  }

  (data || []).forEach(order => {
    if (!ordersBySubId.has(order.sub_id)) ordersBySubId.set(order.sub_id, []);
    ordersBySubId.get(order.sub_id).push(order);
  });

  return ordersBySubId;
}

function renderHistory(links) {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;

  if (!currentUser) {
    historyList.innerHTML = '<div class="history-empty">Đăng nhập để xem các link đã chuyển đổi.</div>';
    return;
  }

  if (!links.length) {
    historyList.innerHTML = '<div class="history-empty">Bạn chưa tạo link nào.</div>';
    return;
  }

  historyList.innerHTML = links.map(link => {
    const createdAt = new Date(link.created_at).toLocaleString('vi-VN');
    const commission = escapeHtml(link.estimated_commission || 'Chưa có dữ liệu');
    const rate = escapeHtml(link.commission_rate || '--');
    const affiliateUrl = escapeHtml(link.affiliate_url);
    const subId = escapeHtml(link.sub_id);
    const linkId = escapeHtml(link.id);
    const productName = escapeHtml(link.product_name || 'Sản phẩm Shopee');
    const productImage = escapeHtml(link.product_image || '');
    const shortUrl = escapeHtml(formatShortUrl(link.affiliate_url));
    const orderMarkup = renderHistoryOrders(link.orders || []);
    const imageMarkup = productImage
      ? `<img class="history-product-img" src="${productImage}" alt="${productName}" loading="lazy">`
      : `<div class="history-product-img history-product-img-fallback">SP</div>`;

    return `
      <div class="history-item" data-affiliate-url="${affiliateUrl}">
        <div class="history-meta">
          <span>${createdAt}</span>
          <span class="history-subid">${subId}</span>
        </div>
        <div class="history-product">
          ${imageMarkup}
          <div class="history-product-main">
            <div class="history-product-top">
              <div>
                <div class="history-product-name">${productName}</div>
                <div class="history-short-url">${shortUrl}</div>
              </div>
              <div class="history-actions">
                <button class="history-action history-copy" type="button" onclick="copyHistoryLink(this)">Copy link</button>
                <a class="history-action history-buy" href="${affiliateUrl}" target="_blank" rel="noopener" onclick="trackAffiliateClick('${linkId}')">Mua ngay</a>
              </div>
            </div>
            <div class="history-commission">
              <span class="history-commission-text">🌸 Hoa hồng ước tính: ${commission}</span>
              <span class="history-rate">${rate}%</span>
            </div>
            ${orderMarkup}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderHistoryOrders(orders) {
  if (!orders.length) {
    return '<div class="history-orders-empty">Chưa ghi nhận đơn hàng</div>';
  }

  return `
    <div class="history-orders">
      ${orders.map(order => {
        const status = getOrderStatusMeta(order.status);
        const purchaseTime = order.purchase_time
          ? new Date(order.purchase_time).toLocaleString('vi-VN')
          : '--';
        const netCommission = formatCurrency(order.net_commission);
        const grossCommission = formatCurrency(order.commission);
        const rate = order.commission_rate == null ? '--' : `${Number(order.commission_rate).toFixed(2)}%`;

        return `
          <div class="history-order">
            <div class="history-order-head">
              <span class="history-order-id">#${escapeHtml(order.shopee_order_id)}</span>
              <span class="history-order-status ${status.className}">${status.label}</span>
            </div>
            <div class="history-order-name">${escapeHtml(order.item_name || 'Đơn Shopee')}</div>
            <div class="history-order-grid">
              <span>Mua: ${escapeHtml(purchaseTime)}</span>
              <span>Rate: ${escapeHtml(rate)}</span>
              <span>Hoa hồng ròng: ${escapeHtml(netCommission)}</span>
              <span>Tổng HH: ${escapeHtml(grossCommission)}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function getOrderStatusMeta(status) {
  const map = {
    pending: { label: 'Đang chờ xử lý', className: 'is-pending' },
    approved: { label: 'Chưa thanh toán', className: 'is-approved' },
    paid: { label: 'Đã hoàn thành', className: 'is-paid' },
    rejected: { label: 'Đã huỷ', className: 'is-rejected' }
  };

  return map[status] || { label: status || 'Không rõ', className: 'is-pending' };
}

function formatCurrency(value) {
  const number = Number(value || 0);
  return `${number.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ`;
}

function formatShortUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url || '';
  }
}

async function copyHistoryLink(button) {
  const item = button.closest('.history-item');
  const link = item?.dataset?.affiliateUrl;
  if (!link) return;

  try {
    await navigator.clipboard.writeText(link);
    button.textContent = 'Đã copy';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = 'Copy link';
      button.classList.remove('copied');
    }, 1800);
  } catch (error) {
    console.warn('Could not copy history link:', error);
  }
}
