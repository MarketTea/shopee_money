/**
 * admin-deals.test.js
 * Chạy: node --test assets/js/admin-deals.test.js
 *
 * Khoá lại logic publish của trang admin:
 *  - Campaign insert OK nhưng products lỗi → phải ROLLBACK campaign (không để campaign rỗng)
 *  - Publish một phần lỗi → preview chỉ giữ campaign lỗi (publish lại không tạo bản trùng)
 *  - Bấm "Preview Parse" lại rồi publish lần 2 → bỏ qua campaign đã publish trong phiên
 *  - Đổi ngày rồi publish lại → được coi là campaign mới (không bị chặn nhầm)
 *
 * Test dùng DOM + Supabase mock, không gọi mạng.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ADMIN_JS = fs.readFileSync(path.join(__dirname, 'admin-deals.js'), 'utf8');
const PARSER_JS = fs.readFileSync(path.join(__dirname, 'deal-parser.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');
const UTILS_JS = fs.readFileSync(path.join(__dirname, 'utils.js'), 'utf8');

function createHarness() {
  const els = {};
  const el = (id) => {
    if (!els[id]) {
      els[id] = {
        id, innerHTML: '', textContent: '', value: '', disabled: false,
        style: {}, dataset: {}, addEventListener: () => {}
      };
    }
    return els[id];
  };

  const log = { campaigns: [], products: [], deletes: [] };
  const toasts = [];

  const campaignInsert = (payload) => ({
    select: () => ({
      single: async () => {
        log.campaigns.push(payload.title);
        return { data: { id: `id-${payload.title}` }, error: null };
      }
    })
  });

  const directInsert = (table, payload) => {
    if (table !== 'deal_products') return { data: null, error: null };

    if (payload.some((product) => product.name.includes('BADPROD'))) {
      return { data: null, error: { message: 'product boom' } };
    }
    log.products.push(...payload.map((product) => product.name));
    return { data: null, error: null };
  };

  const supabaseClient = {
    from(table) {
      return {
        insert(payload) {
          const result = {
            select: () => campaignInsert(payload).select(),
            then: (resolve) => resolve(directInsert(table, payload))
          };
          return result;
        },
        delete: () => ({
          eq: async () => { log.deletes.push(table); return { error: null }; }
        }),
        select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) })
      };
    }
  };

  const sandbox = {
    console,
    setTimeout, clearTimeout,
    JSON, Date, Math, Number, String, Array, Object, RegExp, Set, Map, Boolean,
    Promise, Intl,
    document: {
      getElementById: (id) => ([
        'publishAllBtn', 'publishProgress', 'dealRawContent',
        'parsePreviewSection', 'parsePreview', 'existingCampaignsList'
      ].includes(id) ? el(id) : null),
      addEventListener: () => {},
      querySelectorAll: () => [],
      createElement: () => ({
        className: '', innerText: '', style: {},
        classList: { add() {}, remove() {} },
        remove() {}
      }),
      body: { appendChild() {} }
    },
    window: { addEventListener: () => {}, confirm: () => true },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    supabaseClient,
    confirm: () => true
  };

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const scenario = `
    const toasts = [];
    showToast = (message) => toasts.push(message);

    function camp(title, productName, endDate) {
      return {
        title,
        brand: 'X',
        category: 'Beauty',
        start_date: '2026-10-15',
        end_date: endDate || '2026-10-20',
        highlights: [],
        voucher_codes: [],
        store_url: null,
        raw_content: 'raw ' + title,
        products: [{
          name: productName,
          affiliate_url: 'https://shopee.vn/a-i.1.2',
          discount_label: '',
          has_gift: false,
          gift_description: ''
        }]
      };
    }

    globalThis.__scenario = (async () => {
      // Lần 1: A ok · D lỗi products · C ok
      parsedCampaigns = [camp('CAMP-A', 'SP A'), camp('CAMP-D', 'BADPROD'), camp('CAMP-C', 'SP C')];
      await publishAllCampaigns();

      const run1 = {
        campaigns: __log.campaigns.slice(),
        deleteCalled: __log.deletes.includes('deal_campaigns'),
        products: __log.products.length,
        remaining: parsedCampaigns.map((c) => c.title)
      };

      // Lần 2: admin bấm "Preview Parse" lại (parse lại toàn bộ text) rồi publish
      __log.campaigns.length = 0;
      parsedCampaigns = [camp('CAMP-A', 'SP A'), camp('CAMP-D', 'BADPROD'), camp('CAMP-C', 'SP C')];
      await publishAllCampaigns();

      const run2 = {
        campaigns: __log.campaigns.slice(),
        remaining: parsedCampaigns.map((c) => c.title)
      };

      // Lần 3: đổi ngày của A → phải được publish lại
      __log.campaigns.length = 0;
      parsedCampaigns = [camp('CAMP-A', 'SP A', '2026-10-25')];
      await publishAllCampaigns();

      const run3 = { campaigns: __log.campaigns.slice() };

      return { run1, run2, run3, toasts };
    })();
  `;

  vm.runInContext([UTILS_JS, PARSER_JS, ADMIN_JS, scenario].join('\n'), sandbox);
  sandbox.__log = log;

  return { sandbox, log, toasts };
}

test('publish: products lỗi thì rollback campaign, preview chỉ giữ campaign lỗi', async () => {
  const { sandbox } = createHarness();
  const { run1, toasts } = await sandbox.__scenario;

  assert.equal(run1.campaigns.join(','), 'CAMP-A,CAMP-D,CAMP-C');
  assert.equal(run1.deleteCalled, true, 'phải xoá campaign khi insert products lỗi');
  assert.equal(run1.remaining.join(','), 'CAMP-D');
  assert.equal(run1.products, 2, 'chỉ 2 campaign thành công mới có sản phẩm');
  assert.match(toasts[0], /2 thành công/);
});

test('publish: bấm Preview lại rồi Publish không tạo bản trùng', async () => {
  const { sandbox } = createHarness();
  const { run2 } = await sandbox.__scenario;

  // A và C đã publish ở lần 1 → chỉ còn D được thử lại
  assert.equal(run2.campaigns.join(','), 'CAMP-D');
  assert.equal(run2.remaining.join(','), 'CAMP-D');
});

test('publish: đổi ngày thì được publish lại (không chặn nhầm)', async () => {
  const { sandbox } = createHarness();
  const { run3 } = await sandbox.__scenario;

  assert.equal(run3.campaigns.join(','), 'CAMP-A');
});
