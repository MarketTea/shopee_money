/**
 * deal-parser.js
 * Engine bóc tách nội dung text thô từ group KOC Shopee thành campaign + products.
 *
 * Toàn bộ là hàm thuần (không đụng DOM) → test được bằng `node --test`.
 *
 * Hợp đồng dữ liệu trả về (giữ nguyên để không phá admin-deals.js):
 * {
 *   title, brand|null, category, start_date|null, end_date|null,
 *   store_url|null, highlights: string[], voucher_codes: [{code, desc}],
 *   raw_content, is_active, sort_order,
 *   products: [{ name, description, affiliate_url, discount_label,
 *                has_gift, gift_description, sort_order }]
 * }
 */

/* ── Hằng số dùng chung (trước đây hardcode rải rác 4 nơi) ─────────────────── */

const RE_BLOCK_SEPARATOR = /={3,}/;
const RE_EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;
const RE_NOISE = /[*\[\]▪•●·]/g;
const RE_EMPTY_PARENS = /\(\s*\)/g;
const RE_SPACES = /\s+/g;

const RE_ANY_URL = /https?:\/\//i;
const RE_AFFILIATE_LINK = /https?:\/\/(?:[a-z0-9-]+\.)*shopee\.vn\/(?:a-i\.|abc-i\.)[^\s)]*/i;
const RE_ALL_SHOPEE_URL = /https?:\/\/(?:[a-z0-9-]+\.)*shopee\.vn\/[^\s)]*/gi;

/** Dòng được coi là "tên sản phẩm" (emoji sản phẩm / bullet / "1. [KOL]"). */
const RE_PRODUCT_LINE = /^(?:[🧴✨🌸🤍🦷💗🎈]|▪|•|\d+\.\s*\[?KOL\]?)/u;
const RE_VARIANT_LINE = /^[▪•]/u;
const RE_BULLET_LINE = /^(?:\p{Extended_Pictographic}|[+])/u;
const RE_GIFT_LINE = /🎁|quà tặng/i;
const RE_HEADING = /^(?:top|danh sách|gợi ý|mua \d|deal hot|sản phẩm|combo|ghi chú|lưu ý|xem thêm|note)\b/i;

/** Từ không bao giờ là brand (tránh "NGÀ", "HÀNG", "TRÀN!" như bản cũ). */
const BRAND_STOPWORDS = new Set([
  'SALE', 'DEAL', 'DEALS', 'HOT', 'BRAND', 'BRANDDAY', 'DAY', 'SUPER', 'MEGA', 'FLASH',
  'VOUCHER', 'FREESHIP', 'QUA', 'QUÀ', 'TANG', 'TẶNG', 'MUA', 'GIAM', 'GIẢM', 'SU', 'KIEN',
  'KIỆN', 'THANG', 'THÁNG', 'NGAY', 'NGÀY', 'PHU', 'PHỤ', 'NU', 'NỮ', 'VIET', 'VIỆT', 'NAM',
  'LON', 'LỚN', 'GIUA', 'GIỮA', 'MOI', 'MỚI', 'DAC', 'ĐẶC', 'BIET', 'BIỆT', 'TOAN', 'TOÀN',
  'QUOC', 'QUỐC', 'CHAM', 'CHĂM', 'SOC', 'SÓC', 'THAN', 'THÂN', 'XINH', 'CUNG', 'CÙNG',
  'DEN', 'ĐẾN', 'NHAN', 'NHẬN', 'XIN', 'XỊN', 'KOL', 'KOC', 'SHOPEE', 'SHOP', 'MALL',
  'OFFICIAL', 'STORE', 'VIETNAM', 'COMBO', 'SET', 'TOP'
]);

/** Mã voucher không hợp lệ (từ tiếng Việt bị regex bắt nhầm). */
const VOUCHER_STOPWORDS = new Set([
  'GIAM', 'GIAMGIA', 'GIAMDEN', 'VOUCHER', 'FREESHIP', 'SHOPEE', 'FLASH', 'SALE', 'CODE',
  'NHAPMA', 'TOIDA', 'DONHANG', 'SANPHAM', 'MA', 'SHOP', 'MALL'
]);

const RE_VOUCHER_COLON = /(?:nhập\s+mã|mã(?:\s+giảm(?:\s+giá)?)?|voucher|code)\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9._-]{3,19})/i;
const RE_VOUCHER_NO_COLON = /(?:nhập\s+mã|mã)\s+([A-Z][A-Z0-9]{4,19})\b/;

/* ── API chính ────────────────────────────────────────────────────────────── */

/**
 * Parse toàn bộ nội dung text thô thành mảng campaigns.
 * @param {string} rawText
 * @returns {Array<Object>}
 */
function parseDealContent(rawText) {
  if (!rawText || !String(rawText).trim()) return [];

  return String(rawText)
    .split(RE_BLOCK_SEPARATOR)
    .map((block) => parseBlock(block.trim()))
    .filter((campaign) => campaign && campaign.title && campaign.title.length > 2);
}

/** Parse một block campaign. */
function parseBlock(block) {
  if (!block || block.trim().length < 10) return null;

  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const title = extractTitle(lines);
  if (!title) return null;

  const { startDate, endDate } = extractDates(block);

  // Tính voucher trước để highlights có thể bỏ qua mã/mô tả voucher (tránh lặp)
  const voucherCodes = extractVoucherCodes(lines);
  const highlights = extractHighlights(lines, title, voucherCodes);

  return {
    title: title.substring(0, 200),
    brand: extractBrand(block, title),
    category: inferCategory(block, title),
    start_date: startDate,
    end_date: endDate,
    store_url: extractStoreUrl(block),
    highlights,
    voucher_codes: voucherCodes,
    raw_content: block,
    is_active: true,
    sort_order: 0,
    products: extractProducts(lines, title)
  };
}

/* ── Chuẩn hoá text ───────────────────────────────────────────────────────── */

/** Bỏ emoji, ký hiệu trang trí, ngoặc rỗng; gộp khoảng trắng. */
function stripEmojis(value) {
  return String(value || '')
    .replace(RE_EMOJI, ' ')
    .replace(RE_NOISE, ' ')
    .replace(RE_EMPTY_PARENS, ' ')
    .replace(RE_SPACES, ' ')
    .trim();
}

/** So khớp theo "từ" có hỗ trợ tiếng Việt (JS \b không hiểu chữ có dấu). */
function hasWord(text, words) {
  return words.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}])${escaped}(?![\\p{L}])`, 'iu').test(text);
  });
}

/* ── Tiêu đề ──────────────────────────────────────────────────────────────── */

function extractTitle(lines) {
  for (const line of lines) {
    if (RE_ANY_URL.test(line)) continue;           // dòng chỉ có link thì bỏ
    const cleaned = stripEmojis(line);
    if (cleaned.length > 3) return cleaned;
  }
  return stripEmojis(lines[0] || '');
}

/* ── Ngày ─────────────────────────────────────────────────────────────────── */

/** true nếu 2 ISO date cách nhau không quá maxDays. */
function withinDays(fromIso, toIso, maxDays) {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return (to - from) / 86400000 <= maxDays;
}

/** Tạo ISO date (YYYY-MM-DD) nếu hợp lệ, ngược lại null. */
function toIsoDate(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);

  if (!Number.isInteger(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Bóc ngày bắt đầu/kết thúc.
 * Hỗ trợ: "17.10 – 20.10", "15-16.10", "20/10", "từ 15.10 đến 20.10".
 * '.' hoặc '/' là phân cách NGÀY; '-' hoặc '–' là phân cách KHOẢNG.
 */
function extractDates(block) {
  const year = new Date().getFullYear();

  // 17.10 – 20.10  |  17/10 - 20/10  |  từ 17.10 đến 20.10
  const fullRange = block.match(
    /(\d{1,2})[./](\d{1,2})\s*(?:–|—|-|đến)\s*(\d{1,2})[./](\d{1,2})/i
  );
  if (fullRange) {
    const start = toIsoDate(fullRange[1], fullRange[2], year);
    const end = toIsoDate(fullRange[3], fullRange[4], year);
    if (start) return { startDate: start, endDate: end || start };
  }

  // 15-16.10  (nhiều ngày trong cùng tháng)
  const dayRange = block.match(
    /(?<![\d.,/])(\d{1,2})\s*[–—-]\s*(\d{1,2})[./](\d{1,2})(?![\d.,/])/
  );
  if (dayRange) {
    const start = toIsoDate(dayRange[1], dayRange[3], year);
    const end = toIsoDate(dayRange[2], dayRange[3], year);
    if (start) return { startDate: start, endDate: end || start };
  }

  // 20/10 (một ngày) — có thể có ngày thứ 2 trong block ("15.10 … 20.10")
  const singles = [...block.matchAll(/(?<![\d.,/])(\d{1,2})[./](\d{1,2})(?![\d.,/–—-])/g)]
    .map((m) => toIsoDate(m[1], m[2], year))
    .filter(Boolean);

  if (singles.length) {
    const start = singles[0];
    const end = singles.slice(1).find((date) => date > start && withinDays(start, date, 45));
    return { startDate: start, endDate: end || start };
  }

  return { startDate: null, endDate: null };
}

/* ── Brand ────────────────────────────────────────────────────────────────── */

function cleanBrandCandidate(raw) {
  const cleaned = stripEmojis(String(raw || '').split(/[|–—-]/)[0] || '');
  if (!cleaned || !/\p{L}/u.test(cleaned)) return null;
  if (/^\d/.test(cleaned)) return null;

  const kept = [];
  for (const token of cleaned.split(/\s+/)) {
    if (!token) continue;
    if (BRAND_STOPWORDS.has(token.toUpperCase())) break;
    if (!/\p{L}/u.test(token)) break;
    kept.push(token);
    if (kept.length >= 3) break;
  }

  const brand = kept.join(' ').trim();
  if (!brand || brand.length < 2) return null;
  return brand.substring(0, 60);
}

/**
 * Chỉ trả brand khi có tín hiệu CHẮC CHẮN:
 *   1. "x Innisfree" / "× Innisfree"
 *   2. link *_officialstore / *_official_store
 *   3. "<BRAND> - ..." ở đầu tiêu đề
 *   4. "BRAND DAY ... - CÙNG <BRAND>"
 * Không đoán mò → trả null (brand rỗng còn hơn brand sai).
 */
function extractBrand(block, title) {
  // 1) "x Brand"
  const xMatch = block.match(/(?:^|[\s)])[x×]\s+([^\n]{2,60})/iu);
  if (xMatch) {
    const brand = cleanBrandCandidate(xMatch[1]);
    if (brand) return brand;
  }

  // 2) "HALIO - ...", "LANCOME – ..." (đứng trước rule officialstore để không
  //    bị lấy nhầm tên shop, ví dụ lixibox_official_store)
  const lead = title.match(/^([\p{Lu}\p{N}][\p{Lu}\p{N}&.+\-]{2,29})\s*[–—|:\-]/u);
  if (lead) {
    const brand = cleanBrandCandidate(lead[1]);
    if (brand) return brand;
  }

  // 3) official store URL
  const storeMatch = block.match(/shopee\.vn\/([a-z0-9_]+)_official[_-]?store/i);
  if (storeMatch) {
    const name = storeMatch[1]
      .replace(/_/g, ' ')
      .replace(/\b(vietnam|official|store|shop|mall)\b/gi, '')
      .trim();
    if (name) {
      return name
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
        .substring(0, 60);
    }
  }

  // 4) "SUPER BRAND DAY ... - CÙNG UNILEVER ..."
  const brandDay = title.match(
    /brand\s?day[\s\S]{0,40}?[–—|-]\s*(?:cùng\s+)?([\p{Lu}][\p{Lu}\p{N}&.\s]{2,40})/iu
  );
  if (brandDay) {
    const brand = cleanBrandCandidate(brandDay[1]);
    if (brand) return brand;
  }

  return null;
}

/* ── Category ─────────────────────────────────────────────────────────────── */

const CATEGORY_RULES = [
  ['Beauty', ['serum', 'kem', 'sữa tắm', 'dưỡng', 'tẩy', 'makeup', 'beauty', 'son', 'skincare',
    'chăm da', 'mặt nạ', 'nước hoa', 'kem đánh răng', 'nước tẩy trang', 'sữa rửa mặt']],
  ['Fashion', ['áo', 'váy', 'quần', 'giày', 'boot', 'fashion', 'thời trang', 'cardigan', 'khoác',
    'khăn', 'túi', 'set bộ', 'baby tee', 'đầm']],
  ['Tech', ['máy', 'tech', 'halio', 'ionic', 'sấy tóc', 'triệt lông', 'bàn chải điện', 'thiết bị',
    'tai nghe', 'sạc dự phòng']],
  ['Food', ['đồ ăn', 'thực phẩm', 'bánh', 'drink', 'snack', 'food', 'cà phê', 'trà sữa', 'mì gói']],
  ['Voucher', ['voucher', 'freeship', 'mã giảm', 'flash sale', 'hoàn xu']]
];

function inferCategory(block, title) {
  const text = `${block}\n${title}`;
  const hasProductLink = RE_AFFILIATE_LINK.test(block);

  // Post dạng "thông báo voucher" (không có link sản phẩm) và tiêu đề nói về voucher
  // → Voucher, tránh bị nhận nhầm bởi chữ trong phần nội dung (vd: "đi cà phê").
  if (!hasProductLink && hasWord(title, ['voucher', 'mã giảm', 'mã giảm giá'])) {
    return 'Voucher';
  }

  for (const [category, words] of CATEGORY_RULES) {
    if (category === 'Voucher' && hasProductLink) continue;
    if (hasWord(text, words)) return category;
  }
  return 'Khác';
}

/* ── Store URL ────────────────────────────────────────────────────────────── */

function extractStoreUrl(block) {
  const matches = block.match(RE_ALL_SHOPEE_URL) || [];

  for (const raw of matches) {
    const url = raw.replace(/[),.;:'"]+$/, '');

    if (/(?:\/a-i\.|\/abc-i\.)/i.test(url)) continue;   // link sản phẩm
    if (/\/user\//i.test(url)) continue;                // ví voucher
    if (/\/(?:m|search|cart|checkout|buyer)\//i.test(url)) continue;

    return url;
  }
  return null;
}

/* ── Highlights ───────────────────────────────────────────────────────────── */

function extractHighlights(lines, title, vouchers = []) {
  const normalizedTitle = stripEmojis(title);
  const highlights = [];

  // Mã + mô tả voucher đã hiển thị trong chip copy → không lặp lại ở highlights
  const voucherTexts = new Set();
  for (const voucher of vouchers) {
    if (voucher.code) voucherTexts.add(voucher.code.toUpperCase());
    if (voucher.desc) voucherTexts.add(voucher.desc);
  }

  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || RE_ANY_URL.test(stripped)) continue;

    const cleaned = stripEmojis(stripped).replace(/^[+\-–]\s*/, '');
    if (!cleaned || cleaned.length < 4 || cleaned.length > 100) continue;

    // Không lặp lại tiêu đề / tên sản phẩm / mô tả quà
    if (cleaned === normalizedTitle) continue;
    if (RE_PRODUCT_LINE.test(stripped)) continue;
    if (/[:：]$/.test(cleaned)) continue;                 // dòng heading
    if (voucherTexts.has(cleaned) || voucherTexts.has(cleaned.toUpperCase())) continue;
    if (/^quà tặng\s*[:：]/i.test(cleaned)) continue;

    // Dòng chỉ là mã voucher (sẽ thành chip copy) → không lặp lại trong highlights
    if (/[🎟🎫]/u.test(stripped)
      && /^[A-Z0-9][A-Z0-9._-]{4,19}$/.test(cleaned)
      && /[0-9]/.test(cleaned)) continue;

    const isBullet =
      RE_BULLET_LINE.test(stripped) ||
      /^(?:mua \d|giảm (?:giá|đến|\d)|freeship|flash voucher|hoa hồng)/i.test(stripped);

    if (isBullet) highlights.push(cleaned.substring(0, 100));
  }

  return [...new Set(highlights)].slice(0, 6);
}

/* ── Voucher ──────────────────────────────────────────────────────────────── */

function isPlausibleVoucherCode(code) {
  if (!code || code.length < 5 || code.length > 20) return false;
  if (!/[A-Z]/i.test(code)) return false;
  if (!/[0-9]/.test(code) && code.length < 7) return false;
  if (VOUCHER_STOPWORDS.has(code.toUpperCase())) return false;
  return true;
}

function extractVoucherCodes(lines) {
  const found = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(RE_VOUCHER_COLON) || line.match(RE_VOUCHER_NO_COLON);

    // Dạng rất phổ biến: "🎟️ NEWUSER10GAME77KVY" — mã đứng một mình, không có "Mã:"
    if (!match) {
      const solo = stripEmojis(line);
      const hasVoucherSignal = /[🎟🎫]/u.test(line) || /voucher|mã/i.test(lines[i - 1] || '');

      if (hasVoucherSignal
        && /^[A-Z0-9][A-Z0-9._-]{4,19}$/.test(solo)
        && /[0-9]/.test(solo)                       // bắt buộc có số để tránh nhận nhầm tên brand
        && isPlausibleVoucherCode(solo.toUpperCase())) {
        const soloCode = solo.toUpperCase();
        if (!found.has(soloCode)) {
          let desc = stripEmojis(lines[i + 1] || '');
          if (desc.length < 3) desc = stripEmojis(lines[i - 1] || '');
          found.set(soloCode, { code: soloCode, desc: desc.substring(0, 80) });
          if (found.size >= 10) break;
        }
      }
      continue;
    }

    const code = String(match[1] || '').toUpperCase();
    if (!isPlausibleVoucherCode(code) || found.has(code)) continue;

    // Mô tả: ưu tiên phần còn lại của CHÍNH dòng chứa mã
    let desc = stripEmojis(line.replace(match[0], ''))
      .replace(/^[–—\-:.\s]+/, '')
      .replace(/[–—\-\s]+$/, '');
    if (desc.length < 3) desc = stripEmojis(lines[i - 1] || '');
    if (desc.length < 3) desc = stripEmojis(lines[i + 1] || '');

    found.set(code, { code, desc: desc.substring(0, 80) });
    if (found.size >= 10) break;
  }

  return [...found.values()];
}

/* ── Products ─────────────────────────────────────────────────────────────── */

/** Bỏ ':' / dấu gạch / khoảng trắng thừa ở cuối tên sản phẩm. */
function cleanProductName(name) {
  return stripEmojis(name)
    .replace(/[:：]\s*$/, '')
    .replace(/[–—\-,\s]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function looksLikeHeading(line) {
  const cleaned = stripEmojis(line);
  if (!cleaned) return true;
  if (RE_HEADING.test(cleaned)) return true;
  return false;
}

function isValidProductName(name) {
  if (!name) return false;
  if (name.length < 8 || name.length > 200) return false;
  if (RE_ANY_URL.test(name)) return false;
  if (looksLikeHeading(name)) return false;
  if (!/\p{L}/u.test(name)) return false;
  return true;
}

/**
 * Tên sản phẩm đi kèm 1 dòng link:
 *  - ưu tiên tên đã gom từ dòng sản phẩm phía trên
 *  - nếu không có, lấy dòng text gần nhất phía trên, nhưng bỏ qua heading/URL
 */
function pickProductName(lines, linkIndex, title) {
  const normalizedTitle = stripEmojis(title);

  for (let j = linkIndex - 1, steps = 0; j >= 0 && steps < 3; j--, steps++) {
    const candidate = (lines[j] || '').trim();
    if (!candidate) continue;
    if (RE_ANY_URL.test(candidate)) continue;
    if (looksLikeHeading(candidate)) return '';

    const cleaned = cleanProductName(candidate);
    if (!cleaned || cleaned === normalizedTitle) return '';
    if (isValidProductName(cleaned)) return cleaned;
  }
  return '';
}

/** "▪️ Hũ lẻ: Voucher giảm 45K" → { name: 'Hũ lẻ', discount: 'Voucher giảm 45K' } */
function parseProductLine(line) {
  let cleaned = stripEmojis(line)
    .replace(/^\d+\.\s*/, '')
    .replace(/^(?:\[?KOL\]?\s*)+/i, '')   // "[KOL] [KOL] SERUM" → "SERUM"
    .replace(/^[▪•]\s*/, '')
    .trim();

  let discount = '';

  // "… 150g (giảm 20%)" → name không còn ngoặc, discount = "giảm 20%"
  const paren = cleaned.match(/\(([^)]*(?:giảm|%|\d+\s*[kK])[^)]*)\)\s*$/i);
  if (paren) {
    discount = paren[1].trim().substring(0, 80);
    cleaned = cleaned.replace(paren[0], '').trim();
  }

  // "Hũ lẻ: Voucher giảm 45K" → name "Hũ lẻ", discount "Voucher giảm 45K"
  const colon = cleaned.indexOf(':');
  if (colon > 0 && colon <= 40) {
    const head = cleaned.slice(0, colon).trim();
    const tail = cleaned.slice(colon + 1).trim();
    if (head.length >= 3 && /giảm|voucher|combo|\d+\s*[Kk%]|\d{3}/i.test(tail)) {
      return { name: head.substring(0, 200), discount: tail.substring(0, 80) };
    }
  }

  return { name: cleanProductName(cleaned).substring(0, 200), discount };
}

function extractDiscountNearby(lines, linkIndex) {
  const line = lines[linkIndex - 1] || '';
  if (!line) return '';
  if (RE_ANY_URL.test(line)) return '';
  if (RE_PRODUCT_LINE.test(line)) return '';      // discount của tên SP đã xử lý riêng
  if (RE_GIFT_LINE.test(line)) return '';
  if (looksLikeHeading(line)) return '';
  if (!/giảm|voucher|\d+\s*[%kK]/i.test(line)) return '';

  return stripEmojis(line).substring(0, 80);
}

function extractGiftNearby(lines, linkIndex) {
  for (let j = linkIndex - 1; j >= Math.max(0, linkIndex - 2); j--) {
    const line = lines[j] || '';
    if (RE_GIFT_LINE.test(line)) {
      return stripEmojis(line).replace(/^quà tặng\s*[:：]?/i, '').trim().substring(0, 150);
    }
  }
  return '';
}

function extractProducts(lines, title) {
  const products = [];
  let pendingName = '';
  let pendingDiscount = '';
  let pendingGift = false;
  let pendingGiftDesc = '';
  let lastBaseName = '';   // tên sản phẩm gốc, để ghép các biến thể "▪️ Hũ lẻ"
  let sortOrder = 0;

  const resetPending = () => {
    pendingName = '';
    pendingDiscount = '';
    pendingGift = false;
    pendingGiftDesc = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* 1. Dòng link affiliate → chốt sản phẩm */
    const linkMatch = line.match(RE_AFFILIATE_LINK);
    if (linkMatch) {
      const name = pendingName || pickProductName(lines, i, title);

      if (name && name.length > 2) {
        const hasGift = pendingGift || (!pendingName && RE_GIFT_LINE.test(lines[i - 1] || ''));
        products.push({
          name: name.substring(0, 200),
          description: '',
          affiliate_url: linkMatch[0],
          discount_label: (pendingDiscount || extractDiscountNearby(lines, i) || '').substring(0, 80),
          has_gift: hasGift,
          gift_description: hasGift
            ? (pendingGiftDesc || extractGiftNearby(lines, i) || '').substring(0, 150)
            : '',
          sort_order: sortOrder++
        });
      }

      resetPending();
      continue;

    }

    /* 2. Dòng tên sản phẩm */
    if (RE_PRODUCT_LINE.test(line)) {
      const info = parseProductLine(line);
      if (info.name && info.name.length > 2) {
        if (RE_VARIANT_LINE.test(line) && (pendingName || lastBaseName)) {
          // "▪️ Hũ lẻ" / "▪️ Combo 2 hũ" → coi là biến thể của sản phẩm gốc
          const base = pendingName || lastBaseName;
          pendingName = `${base} – ${info.name}`.substring(0, 200);
        } else {
          pendingName = info.name;
          lastBaseName = info.name;
          pendingDiscount = '';
          pendingGift = false;
          pendingGiftDesc = '';
        }
        if (info.discount) pendingDiscount = info.discount;
      }
      continue;
    }

    /* 3. Dòng meta (giảm giá / quà tặng) của sản phẩm đang chờ link */
    if (pendingName) {
      if (!RE_ANY_URL.test(line) && /giảm|voucher|combo|\d+\s*[Kk%]/i.test(line)) {
        const discount = stripEmojis(line);
        if (discount) pendingDiscount = discount.substring(0, 80);
      }
      if (RE_GIFT_LINE.test(line)) {
        pendingGift = true;
        const gift = stripEmojis(line).replace(/^quà tặng\s*[:：]?/i, '').trim();
        if (gift) pendingGiftDesc = gift.substring(0, 150);
      }
    }
  }

  return products;
}

/* ── Export cho test (browser bỏ qua block này) ────────────────────────────── */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseDealContent,
    parseBlock,
    stripEmojis,
    extractDates,
    extractBrand,
    inferCategory,
    extractStoreUrl,
    extractHighlights,
    extractVoucherCodes,
    extractProducts,
    toIsoDate
  };
}
