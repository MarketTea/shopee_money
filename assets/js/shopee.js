/* ── HELPERS (ported from Telegram bot) ── */
function isShopeeLink(url) {
  return url.includes('shopee.vn') ||
    url.includes('s.shopee.vn') ||
    url.includes('shope.ee') ||
    url.includes('shp.ee');
}

function needsResolve(url) {
  if (url.includes('an_redir')) return false;
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === 'shopee.vn') {
      return !pathname.startsWith('/product/') && !/-i\.\d+/.test(pathname);
    }
    return true; // shp.ee, shope.ee, vn.shp.ee, etc. đều cần resolve
  } catch { return false; }
}

function normalizeShopeeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'shopee.vn' && parsed.pathname.startsWith('/product/')) {
      parsed.search = '';
      parsed.hash = '';
    }
    return parsed.toString();
  } catch { return url; }
}

// Gọi public Redirect Checker API (CORS-enabled, không cần API key) để resolve redirect server-side
async function resolveShortUrl(url) {
  const response = await fetch('https://www.redirectcheck.org/api/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: url,
      method: 'GET',
      followMetaRefresh: true
    })
  });

  if (!response.ok) throw new Error('API error');

  const data = await response.json();
  const resolvedUrl = data.final_result?.final_url || (data.redirects && data.redirects[0]?.to);

  if (!resolvedUrl || !resolvedUrl.includes('shopee.vn')) {
    throw new Error('Could not resolve to shopee.vn');
  }

  return normalizeShopeeUrl(resolvedUrl);
}

async function createTrackedAffLink(originalLink, normalizedLink) {
  const { data, error } = await supabaseClient.functions.invoke('convert-link', {
    body: {
      original_url: originalLink,
      normalized_url: normalizedLink
    }
  });

  if (error || !data?.affiliate_url) {
    throw new Error(await getSupabaseFunctionError(error, data));
  }

  return data;
}

async function getSupabaseFunctionError(error, data) {
  if (data?.error) return data.error;

  if (error?.context) {
    try {
      const body = await error.context.clone().json();
      if (body?.error) return body.error;
    } catch {
      try {
        const text = await error.context.clone().text();
        if (text) return text;
      } catch { }
    }
  }

  return error?.message || 'Could not create affiliate link';
}
