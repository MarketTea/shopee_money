function updatePayoutUi() {
  const payoutLoggedOut = document.getElementById('payoutLoggedOut');
  const payoutSetupPrompt = document.getElementById('payoutSetupPrompt');
  const payoutDashboard = document.getElementById('payoutDashboard');
  if (!payoutLoggedOut) return;

  if (currentUser) {
    payoutLoggedOut.classList.add('hide');
    return;
  }

  payoutLoggedOut.classList.remove('hide');
  if (payoutSetupPrompt) payoutSetupPrompt.style.display = 'none';
  if (payoutDashboard) payoutDashboard.style.display = 'none';
  closePayoutModal();
}

function resetPayoutForm() {
  payoutQrFile = null;
  revokePayoutPreviewUrl();
  const recipientInput = document.getElementById('payoutRecipientName');
  const qrInput = document.getElementById('payoutQrInput');
  const fileName = document.getElementById('payoutFileName');
  const uploadedAt = document.getElementById('payoutUploadedAt');
  if (recipientInput) recipientInput.value = '';
  if (qrInput) qrInput.value = '';
  if (fileName) fileName.textContent = '';
  if (uploadedAt) uploadedAt.textContent = '';
  setPayoutPreview('');
  clearPayoutStatus();
}

async function loadPayoutProfile() {
  if (!supabaseClient || !currentUser) return;

  clearPayoutStatus();
  const uploadedAt = document.getElementById('payoutUploadedAt');
  if (uploadedAt) uploadedAt.textContent = 'Đang tải thông tin nhận tiền...';

  const { data, error } = await supabaseClient
    .from('profiles')
    .select('payout_recipient_name, payout_qr_path, payout_qr_uploaded_at')
    .eq('id', currentUser.id)
    .maybeSingle();

  const payoutSetupPrompt = document.getElementById('payoutSetupPrompt');
  const payoutDashboard = document.getElementById('payoutDashboard');

  if (error) {
    showPayoutStatus('Không tải được thông tin nhận tiền. Hãy kiểm tra RLS/schema Supabase.', 'error');
    if (uploadedAt) uploadedAt.textContent = '';
    console.error(error);
    return;
  }

  const recipientInput = document.getElementById('payoutRecipientName');
  if (recipientInput) recipientInput.value = data?.payout_recipient_name || '';

  if (data?.payout_qr_uploaded_at && uploadedAt) {
    uploadedAt.textContent = `Cập nhật lần cuối: ${new Date(data.payout_qr_uploaded_at).toLocaleString('vi-VN')}`;
  } else if (uploadedAt) {
    uploadedAt.textContent = '';
  }

  if (data?.payout_qr_path) {
    await loadPayoutQrPreview(data.payout_qr_path);
    if (payoutSetupPrompt) payoutSetupPrompt.style.display = 'none';
    if (payoutDashboard) payoutDashboard.style.display = 'block';

    const qrImageEl = document.getElementById('payoutQrImage');
    if (qrImageEl) {
      const { data: signedData, error: signedError } = await supabaseClient.storage
        .from(PAYOUT_QR_BUCKET)
        .createSignedUrl(data.payout_qr_path, 60 * 60);
      if (!signedError && signedData?.signedUrl) {
        qrImageEl.src = signedData.signedUrl;
      }
    }

    await loadPayoutOrders();
  } else {
    setPayoutPreview('');
    if (payoutSetupPrompt) payoutSetupPrompt.style.display = 'flex';
    if (payoutDashboard) payoutDashboard.style.display = 'none';
  }
}

async function loadPayoutQrPreview(path) {
  revokePayoutPreviewUrl();
  const { data, error } = await supabaseClient.storage
    .from(PAYOUT_QR_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    showPayoutStatus('Không tạo được preview mã QR. File vẫn có thể đã được lưu trong Storage.', 'error');
    setPayoutPreview('');
    console.error(error);
    return;
  }

  setPayoutPreview(data.signedUrl);
}

function handlePayoutQrSelected(event) {
  const file = event.target.files?.[0] || null;
  const fileName = document.getElementById('payoutFileName');
  payoutQrFile = null;
  clearPayoutStatus();

  if (!file) {
    if (fileName) fileName.textContent = '';
    return;
  }

  if (!PAYOUT_QR_ALLOWED_TYPES.includes(file.type)) {
    event.target.value = '';
    showPayoutStatus('Vui lòng chọn ảnh PNG, JPG, JPEG hoặc WEBP.', 'error');
    if (fileName) fileName.textContent = '';
    return;
  }

  if (file.size > PAYOUT_QR_MAX_BYTES) {
    event.target.value = '';
    showPayoutStatus('Ảnh QR tối đa 2MB. Vui lòng chọn ảnh nhẹ hơn.', 'error');
    if (fileName) fileName.textContent = '';
    return;
  }

  payoutQrFile = file;
  if (fileName) fileName.textContent = `Đã chọn: ${file.name}`;
  revokePayoutPreviewUrl();
  payoutPreviewObjectUrl = URL.createObjectURL(file);
  setPayoutPreview(payoutPreviewObjectUrl);
}

async function savePayoutQr(event) {
  event.preventDefault();
  if (!supabaseClient || !currentUser) {
    showPayoutStatus('Vui lòng đăng nhập Google trước khi lưu mã QR.', 'error');
    return;
  }

  const recipientInput = document.getElementById('payoutRecipientName');
  const recipientName = recipientInput?.value.trim() || '';

  if (!recipientName) {
    showPayoutStatus('Vui lòng nhập tên người nhận.', 'error');
    recipientInput?.focus();
    return;
  }

  setPayoutSaving(true);
  clearPayoutStatus();

  try {
    const currentProfile = await getCurrentPayoutProfile();
    let qrPath = currentProfile?.payout_qr_path || '';
    let uploadedAt = currentProfile?.payout_qr_uploaded_at || null;
    let staleQrPath = '';

    if (payoutQrFile) {
      const ext = getPayoutQrExtension(payoutQrFile);
      staleQrPath = qrPath;
      qrPath = `${currentUser.id}/qr.${ext}`;
      uploadedAt = new Date().toISOString();

      const { error: uploadError } = await supabaseClient.storage
        .from(PAYOUT_QR_BUCKET)
        .upload(qrPath, payoutQrFile, {
          cacheControl: '3600',
          contentType: payoutQrFile.type,
          upsert: true
        });

      if (uploadError) throw uploadError;

      if (staleQrPath && staleQrPath !== qrPath) {
        await supabaseClient.storage.from(PAYOUT_QR_BUCKET).remove([staleQrPath]);
      }
    }

    if (!qrPath) {
      showPayoutStatus('Vui lòng chọn ảnh mã QR nhận tiền.', 'error');
      return;
    }

    const { error: upsertError } = await supabaseClient
      .from('profiles')
      .upsert({
        id: currentUser.id,
        email: currentUser.email,
        full_name: currentUser.user_metadata?.full_name || null,
        avatar_url: currentUser.user_metadata?.avatar_url || null,
        payout_recipient_name: recipientName,
        payout_qr_path: qrPath,
        payout_qr_uploaded_at: uploadedAt || new Date().toISOString()
      }, { onConflict: 'id' });

    if (upsertError) throw upsertError;

    payoutQrFile = null;
    const qrInput = document.getElementById('payoutQrInput');
    const fileName = document.getElementById('payoutFileName');
    if (qrInput) qrInput.value = '';
    if (fileName) fileName.textContent = '';
    await loadPayoutProfile();
    showPayoutStatus('Đã lưu thông tin nhận hoàn tiền.', 'success');
    setTimeout(() => {
      closePayoutModal();
    }, 1200);
  } catch (error) {
    showPayoutStatus(`Không lưu được thông tin nhận tiền: ${error.message || 'Lỗi không xác định'}`, 'error');
    console.error(error);
  } finally {
    setPayoutSaving(false);
  }
}

async function getCurrentPayoutProfile() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('payout_qr_path, payout_qr_uploaded_at')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function getPayoutQrExtension(file) {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

function setPayoutPreview(src) {
  const preview = document.getElementById('payoutQrPreview');
  const previewBox = preview?.closest('.payout-preview');
  if (!preview || !previewBox) return;

  if (src) {
    preview.src = src;
    previewBox.classList.add('has-image');
    return;
  }

  preview.removeAttribute('src');
  previewBox.classList.remove('has-image');
}

function revokePayoutPreviewUrl() {
  if (payoutPreviewObjectUrl) {
    URL.revokeObjectURL(payoutPreviewObjectUrl);
    payoutPreviewObjectUrl = null;
  }
}

function setPayoutSaving(isSaving) {
  const btn = document.getElementById('payoutSaveBtn');
  const label = document.getElementById('payoutSaveLabel');
  const spinner = document.getElementById('payoutSpinner');
  if (btn) btn.disabled = isSaving;
  if (label) label.textContent = isSaving ? 'Đang lưu...' : 'Lưu thông tin nhận tiền';
  if (spinner) spinner.style.display = isSaving ? 'block' : 'none';
}

function showPayoutStatus(message, type) {
  const status = document.getElementById('payoutStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `payout-status show ${type}`;
}

function clearPayoutStatus() {
  const status = document.getElementById('payoutStatus');
  if (!status) return;
  status.textContent = '';
  status.className = 'payout-status';
}

function openPayoutModal() {
  const modal = document.getElementById('payoutModal');
  if (modal) {
    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      modal.classList.add('show');
    }
    clearPayoutStatus();
  }
}

function closePayoutModal() {
  const modal = document.getElementById('payoutModal');
  if (modal) {
    if (typeof modal.close === 'function') {
      modal.close();
    } else {
      modal.classList.remove('show');
    }
  }
}

window.addEventListener('click', (event) => {
  const modal = document.getElementById('payoutModal');
  if (event.target === modal) {
    closePayoutModal();
  }
});

async function loadPayoutOrders() {
  const totalEl = document.getElementById('payoutEstimatedTotal');
  const listEl = document.getElementById('payoutOrdersList');
  if (!totalEl || !listEl) return;

  totalEl.textContent = '0đ';
  listEl.innerHTML = '<div class="history-empty">Đang tải danh sách đơn hàng...</div>';

  try {
    const { data, error } = await supabaseClient
      .from('orders')
      .select(`
        shopee_order_id,
        item_name,
        commission,
        net_commission,
        status,
        purchase_time,
        created_at,
        completed_at,
        profiles (
          email,
          full_name
        ),
        affiliate_links:sub_id (
          original_url,
          affiliate_url,
          product_name
        ),
        commission_ledger (
          amount,
          status
        )
      `)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    const orders = data || [];
    
    orders.sort((a, b) => {
      const timeA = new Date(a.purchase_time || a.created_at || 0);
      const timeB = new Date(b.purchase_time || b.created_at || 0);
      return timeB - timeA;
    });

    let totalNetCommission = 0;
    orders.forEach(order => {
      totalNetCommission += Number(order.net_commission || 0);
    });

    totalEl.textContent = formatCurrency(totalNetCommission);

    if (orders.length === 0) {
      listEl.innerHTML = '<div class="history-empty">Chưa có đơn hàng nào được ghi nhận.</div>';
      return;
    }

    listEl.innerHTML = orders.map(order => {
      const name = order.item_name || order.affiliate_links?.product_name || 'Đơn hàng Shopee';
      const time = order.purchase_time ? new Date(order.purchase_time).toLocaleDateString('vi-VN') : '--';
      const netComm = formatCurrency(order.net_commission);
      const statusMeta = getOrderStatusMeta(order.status);

      return `
        <div class="payout-order-row">
          <div class="payout-order-info">
            <span class="payout-order-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <span class="payout-order-meta">Mã đơn: ${escapeHtml(order.shopee_order_id)} | Ngày: ${time}</span>
          </div>
          <div class="payout-order-right">
            <span class="payout-order-amount">+${netComm}</span>
            <span class="payout-order-status ${statusMeta.className}">${statusMeta.label}</span>
          </div>
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error('Could not load orders:', error);
    listEl.innerHTML = '<div class="history-empty">Không tải được danh sách đơn hàng.</div>';
  }
}
