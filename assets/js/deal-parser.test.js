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
  assert.equal(campaigns.length, 7);

  for (const campaign of campaigns) {
    assert.ok(campaign.title.length > 3, `title rỗng: ${campaign.title}`);
    assert.ok(campaign.raw_content.length > 0);
  }
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
        /^https:\/\/shopee\.vn\/(a-i|abc-i)\./,
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
    assert.ok(!/\/a-i\.|\/abc-i\./.test(campaign.store_url), `store là link SP: ${campaign.store_url}`);
    assert.ok(!/\/user\//.test(campaign.store_url), `store là ví voucher: ${campaign.store_url}`);
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
