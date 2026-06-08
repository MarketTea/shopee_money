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
