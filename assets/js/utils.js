function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCurrency(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(number).replace('₫', 'đ');
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'custom-toast';
  toast.innerText = message;
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);

  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

function getOrderStatusMeta(status) {
  const map = {
    pending: { label: 'Đang chờ xử lý', className: 'is-pending' },
    approved: { label: 'Hoàn thành', className: 'is-approved' },
    paid: { label: 'Đã thanh toán', className: 'is-paid' },
    rejected: { label: 'Đã hủy', className: 'is-rejected' }
  };

  return map[status] || { label: status || 'Không rõ', className: 'is-pending' };
}


