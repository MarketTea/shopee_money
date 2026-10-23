/**
 * deal-parser.test.js
 * Chạy: node --test assets/js/deal-parser.test.js
 *
 * Đây là "lưới an toàn" cho các bug đã sửa:
 *  - C2: parser từng sinh ngày không hợp lệ (2026-16-15) → publish fail
 *  - C3: brand bị bóc thành rác ("NGÀ", "50%", "TRÀN!")
 *  - C4: tên sản phẩm bị lấy thành URL / heading
 *  - C14: voucher trùng / mã rác
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const parser = require('./deal-parser.js');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'plans', 'deal_hot.txt'),
  'utf8'
);

const campaigns = parser.parseDealContent(FIXTURE);

const isValidIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

test('parse được toàn bộ campaign trong fixture', () => {
  assert.equal(campaigns.length, 11);

  for (const campaign of campaigns) {
    assert.ok(campaign.title.length > 3, `title rỗng: ${campaign.title}`);
    assert.ok(campaign.raw_content.length > 0);
  }
});

test('mọi link Shopee trong fixture đều được convert (sản phẩm / store / CTA)', () => {
  const urls = [...new Set(
    (FIXTURE.match(/https?:\/\/[^\s]*?shopee\.vn\/[^\s]+/g) || [])
      .map((url) => url.replace(/[),.;:'"]+$/, ''))
  )];

  const converted = new Set();
  for (const campaign of campaigns) {
    if (campaign.store_url) converted.add(campaign.store_url);
    for (const product of campaign.products) converted.add(product.affiliate_url);
    for (const action of campaign.action_links || []) converted.add(action.url);
  }

  const missing = urls.filter((url) => !converted.has(url));
  assert.deepEqual(missing, [], `link chưa được convert: ${missing.join(', ')}`);
  assert.ok(urls.length >= 40, `fixture ít link quá: ${urls.length}`);
});

test('nhận đủ mọi định dạng link sản phẩm (a-i / abc-i / product)', () => {
  assert.equal(parser.isProductUrl('https://shopee.vn/a-i.111138057.42733385498'), true);
  assert.equal(parser.isProductUrl('https://shopee.vn/abc-i.111138057.18876673152'), true);
  assert.equal(parser.isProductUrl('https://shopee.vn/product/130860061/54609000076'), true);
  assert.equal(
    parser.isProductUrl('https://shopee.vn/product/130860061/54609000076?sp_atk=abc'),
    true
  );
  assert.equal(parser.isProductUrl('https://shopee.vn/innisfreevietnam_officialstore'), false);
  assert.equal(
    parser.isProductUrl('https://shopee.vn/colgate.palmolive_vietnam?shopCollection=1'),
    false
  );

  const colgate = campaigns.find((c) => c.title.includes('Colgate'));

  assert.equal(colgate.products.length, 3, 'phải lấy đủ 3 sản phẩm Colgate');
  assert.ok(
    colgate.products.some((p) => p.affiliate_url === 'https://shopee.vn/product/130860061/54609000076'),
    'thiếu link dạng /product/<shopId>/<itemId>'
  );
  assert.equal(colgate.store_url, 'https://shopee.vn/colgate.palmolive_vietnam');
});

test('link sự kiện / voucher / bộ sưu tập → action_links (CTA)', () => {
  assert.equal(parser.isEventUrl('https://shopee.vn/m/15-sale-giua-thang'), true);
  assert.equal(parser.isEventUrl('https://shopee.vn/m/goi-ShopeeVIP'), true);
  assert.equal(parser.isEventUrl('https://shopee.vn/user/voucher-wallet/'), true);
  assert.equal(
    parser.isEventUrl('https://shopee.vn/colgate.palmolive_vietnam?shopCollection=275423160'),
    true
  );
  assert.equal(parser.isEventUrl('https://shopee.vn/product/130860061/54609000076'), false);
  assert.equal(parser.isEventUrl('https://shopee.vn/innisfreevietnam_officialstore'), false);

  const colgate = campaigns.find((c) => c.title.includes('Colgate'));
  assert.equal(colgate.action_links.length, 2);
  assert.ok(colgate.action_links.every((a) => a.url.includes('?shopCollection=')));
  assert.ok(colgate.action_links.every((a) => a.cta_label.includes('Bộ Sưu Tập')));
  // Label lấy theo heading IN HOA, không phải dòng "Voucher giảm đến 25%" giống nhau
  assert.match(colgate.action_links[0].label, /HARRY POTTER/);
  assert.match(colgate.action_links[1].label, /OPTIC WHITE/);

  const voucherWallet = campaigns.find((c) => c.title.includes('SALE LỚN GIỮA THÁNG'));
  assert.equal(voucherWallet.action_links[0].url, 'https://shopee.vn/user/voucher-wallet/');

  // Campaign vừa có sản phẩm vừa có CTA (không được nuốt mất 1 trong 2)
  assert.ok(colgate.products.length && colgate.action_links.length);
});

test('C2: mọi ngày đều là ISO hợp lệ và end >= start', () => {
  for (const campaign of campaigns) {
    if (campaign.start_date) {
      assert.ok(isValidIsoDate(campaign.start_date), `start_date sai: ${campaign.start_date}`);
    }
    if (campaign.end_date) {
      assert.ok(isValidIsoDate(campaign.end_date), `end_date sai: ${campaign.end_date}`);
    }
    if (campaign.start_date && campaign.end_date) {
      assert.ok(campaign.end_date >= campaign.start_date, `end < start: ${campaign.title}`);
    }
  }
});

test('C2: từ chối tháng 16 (regression 2026-16-15)', () => {
  assert.equal(parser.toIsoDate('16', '16', 2026), null);
  assert.equal(parser.toIsoDate('31', '02', 2026), null);   // 31/02
  assert.equal(parser.toIsoDate('29', '02', 2026), null);   // 2026 không nhuận
  assert.equal(parser.toIsoDate('17', '10', 2026), '2026-10-17');
});

test('C2: "15-16.10" là khoảng 15→16.10, không phải tháng 16', () => {
  const dates = parser.extractDates('DUY NHẤT 15-16.10');
  const year = new Date().getFullYear();

  assert.equal(dates.startDate, `${year}-10-15`);
  assert.equal(dates.endDate, `${year}-10-16`);
});

test('C2/C13: "15.10 … 20.10" (có chữ ở giữa) lấy được cả 2 mốc', () => {
  const dates = parser.extractDates('ECOCHIC SALE 15.10 – ĐÓN NGÀY PHỤ NỮ VIỆT NAM 20.10');
  const year = new Date().getFullYear();

  assert.equal(dates.startDate, `${year}-10-15`);
  assert.equal(dates.endDate, `${year}-10-20`);
});

test('C2: số tiền không bị nhận nhầm thành ngày', () => {
  const dates = parser.extractDates('Giảm 150.000Đ cho đơn từ 1.200.000Đ');
  assert.equal(dates.startDate, null);
  assert.equal(dates.endDate, null);
});

test('C2: giá / kích thước không bị nhận nhầm thành ngày', () => {
  const year = new Date().getFullYear();

  assert.equal(parser.extractDates('Giảm đến 1.5 triệu đơn từ 150.000Đ').startDate, null);
  assert.equal(parser.extractDates('MacBook Air 13.6 inch, M5, 16GB RAM').startDate, null);
  assert.equal(parser.extractDates('Voucher giảm đến 9.9%').startDate, null);

  // Ngày thật vẫn phải nhận đúng
  assert.equal(parser.extractDates('SALE 10.10').startDate, `${year}-10-10`);

  // Regression: block công nghệ từng bị gán 2026-06-13 vì "13.6 inch"
  const tech = campaigns.find((c) => c.title.includes('SIÊU DEAL CÔNG NGHỆ'));
  assert.equal(tech.start_date, null);
  assert.equal(tech.end_date, null);
});

test('C3: brand có tín hiệu rõ ràng, không có brand rác', () => {
  const byTitle = (needle) => campaigns.find((c) => c.title.includes(needle));

  assert.equal(byTitle('UNILEVER').brand, 'UNILEVER');
  assert.equal(byTitle('Innisfree').brand, 'Innisfree');
  assert.equal(byTitle('HALIO').brand, 'HALIO');
  assert.equal(byTitle('LANCOME').brand, 'LANCOME');

  for (const campaign of campaigns) {
    if (campaign.brand === null) continue;
    assert.ok(campaign.brand.length >= 2, `brand quá ngắn: ${campaign.brand}`);
    assert.ok(!/^\d+[$%]?$/.test(campaign.brand), `brand là số: ${campaign.brand}`);
    assert.ok(!/[!?]$/.test(campaign.brand), `brand là câu cảm thán: ${campaign.brand}`);
  }
});

test('C4: tên sản phẩm không phải URL, không phải heading rỗng', () => {
  let total = 0;

  for (const campaign of campaigns) {
    for (const product of campaign.products) {
      total++;
      assert.ok(!/https?:\/\//i.test(product.name), `tên SP là URL: ${product.name}`);
      assert.ok(product.name.length >= 3, `tên SP quá ngắn: ${product.name}`);
      assert.ok(!/[:：]$/.test(product.name), `tên SP kết thúc bằng ':': ${product.name}`);
      assert.match(
        product.affiliate_url,
        /^https:\/\/shopee\.vn\/(?:product\/\d+\/\d+|[a-z0-9._%-]*-i\.\d+\.\d+)/,
        `affiliate_url sai: ${product.affiliate_url}`
      );
    }
  }

  assert.ok(total >= 25, `quá ít sản phẩm parse được: ${total}`);
});

test('C4: gift/discount được gắn đúng sản phẩm', () => {
  const unilever = campaigns.find((c) => c.title.includes('UNILEVER'));

  const doveSerum = unilever.products.find((p) => p.name.includes('SỮA TẮM DOVE SERUM'));
  assert.ok(doveSerum, 'thiếu sản phẩm SỮA TẮM DOVE SERUM');
  assert.equal(doveSerum.has_gift, true);
  assert.match(doveSerum.gift_description, /Blindbox|tote/i);

  const refill = unilever.products.find((p) => p.name.includes('Hũ lẻ'));
  assert.ok(refill, 'thiếu biến thể Hũ lẻ');
  assert.equal(refill.discount_label, 'Voucher giảm 45K');
  assert.equal(refill.has_gift, false);
});

test('C14: voucher đúng mã, không trùng, không lấy từ "Mã giảm ..."', () => {
  const codes = campaigns.flatMap((c) => c.voucher_codes.map((v) => v.code));

  assert.deepEqual(codes.sort(), ['ECOCBTDO1', 'ECOCVC150', 'LIXI1010']);

  for (const campaign of campaigns) {
    const seen = new Set();
    for (const voucher of campaign.voucher_codes) {
      assert.ok(/^[A-Z0-9._-]{4,20}$/.test(voucher.code), `mã sai định dạng: ${voucher.code}`);
      assert.ok(!seen.has(voucher.code), `mã trùng: ${voucher.code}`);
      assert.ok(!/GIAM|VOUCHER|FREESHIP/.test(voucher.code), `mã rác: ${voucher.code}`);
      seen.add(voucher.code);
    }
  }
});

test('store_url không phải link sản phẩm / ví voucher', () => {
  for (const campaign of campaigns) {
    if (!campaign.store_url) continue;
    assert.ok(
      !/\/a-i\.|\/abc-i\.|\/product\//.test(campaign.store_url),
      `store là link SP: ${campaign.store_url}`
    );
    assert.ok(!/\/user\//.test(campaign.store_url), `store là ví voucher: ${campaign.store_url}`);
    assert.ok(!/\?/.test(campaign.store_url), `store là landing page: ${campaign.store_url}`);
    assert.match(campaign.store_url, /^https:\/\/[a-z0-9.-]*shopee\.vn\//i);
  }
});

test('post chỉ có voucher (không link sản phẩm): bắt mã, category Voucher', () => {
  const text = `🎮💸 CUỐI TUẦN RỒI, CÓ VOUCHER 100K THÌ CẦN GÌ ĐI ĐÂU NỮA? 🤣

Người ta đi cà phê, đi chill… còn tui ngồi nghía wishlist rồi tiện tay lấy voucher 100K 🥹

🎟️ NEWUSER10GAME77KVY  
👉 ĐƠN ĐẦU TIÊN - GIẢM 100K | ĐƠN TỪ 0Đ

👀 Cuối tuần cứ thong thả săn, món nào ưng thì hốt! 🛒`;

  const [campaign] = parser.parseDealContent(text);

  assert.equal(campaign.title, 'CUỐI TUẦN RỒI, CÓ VOUCHER 100K THÌ CẦN GÌ ĐI ĐÂU NỮA?');
  assert.equal(campaign.category, 'Voucher');
  assert.equal(campaign.brand, null);
  assert.equal(campaign.start_date, null);
  assert.equal(campaign.end_date, null);
  assert.equal(campaign.products.length, 0);

  assert.deepEqual(campaign.voucher_codes, [{
    code: 'NEWUSER10GAME77KVY',
    desc: 'ĐƠN ĐẦU TIÊN - GIẢM 100K | ĐƠN TỪ 0Đ'
  }]);

  assert.ok(
    !campaign.highlights.includes('NEWUSER10GAME77KVY'),
    'mã voucher không được lặp lại trong highlights (đã có chip copy)'
  );
  assert.ok(
    !campaign.highlights.includes('ĐƠN ĐẦU TIÊN - GIẢM 100K | ĐƠN TỪ 0Đ'),
    'mô tả voucher không được lặp lại trong highlights'
  );
  assert.deepEqual(campaign.highlights, ['Cuối tuần cứ thong thả săn, món nào ưng thì hốt!']);
});
