import fs from 'node:fs/promises';
import path from 'node:path';

const CSV_COLUMNS = {
  orderId: 'ID đơn hàng',
  orderStatus: 'Trạng thái đặt hàng',
  checkoutId: 'Checkout id',
  purchaseTime: 'Thời Gian Đặt Hàng',
  completedAt: 'Thời gian hoàn thành',
  clickTime: 'Thời gian Click',
  itemId: 'Item id',
  itemName: 'Tên Item',
  modelId: 'ID Model',
  commission: 'Tổng hoa hồng đơn hàng(₫)',
  netCommission: 'Hoa hồng ròng tiếp thị liên kết(₫)',
  commissionRate: 'Mức hoa hồng tiếp thị liên kết theo thỏa thuận',
  subId1: 'Sub_id1',
  subId2: 'Sub_id2',
  subId3: 'Sub_id3',
  subId4: 'Sub_id4',
  subId5: 'Sub_id5',
  channel: 'Kênh',
};

const STATUS_MAP = new Map([
  ['Đang chờ xử lý', 'pending'],
  ['Hoàn thành', 'approved'],
  ['Đã hủy', 'rejected'],
]);

const REQUIRED_COLUMNS = [
  CSV_COLUMNS.orderId,
  CSV_COLUMNS.orderStatus,
  CSV_COLUMNS.checkoutId,
  CSV_COLUMNS.purchaseTime,
  CSV_COLUMNS.itemId,
  CSV_COLUMNS.itemName,
  CSV_COLUMNS.commission,
  CSV_COLUMNS.netCommission,
  CSV_COLUMNS.commissionRate,
  CSV_COLUMNS.subId1,
];

const csvPath = process.argv[2];
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!csvPath) {
  fail('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-shopee-conversions.mjs /path/AffiliateCommissionReport.csv');
}

if (!supabaseUrl || !serviceRoleKey) {
  fail('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

let importId = '';

try {
  const csvText = await fs.readFile(csvPath, 'utf8');
  const rows = parseCsv(csvText);
  if (!rows.length) fail('CSV has no data rows');

  validateColumns(Object.keys(rows[0]));

  const filename = path.basename(csvPath);
  const importBatch = await insertOne('shopee_conversion_imports', {
    filename,
    row_count: rows.length,
    status: 'processing',
  });
  importId = importBatch.id;

  const subIds = unique(rows.map((row) => clean(row[CSV_COLUMNS.subId1])).filter(Boolean));
  const linksBySubId = await loadAffiliateLinks(subIds);

  const rawRows = rows.map((row, index) => {
    const subId1 = clean(row[CSV_COLUMNS.subId1]);
    const matchedLink = subId1 ? linksBySubId.get(subId1) : null;

    return {
      import_id: importId,
      row_number: index + 1,
      shopee_order_id: clean(row[CSV_COLUMNS.orderId]) || null,
      checkout_id: clean(row[CSV_COLUMNS.checkoutId]) || null,
      item_id: clean(row[CSV_COLUMNS.itemId]) || null,
      model_id: clean(row[CSV_COLUMNS.modelId]) || null,
      shopee_status: clean(row[CSV_COLUMNS.orderStatus]) || null,
      item_name: clean(row[CSV_COLUMNS.itemName]) || null,
      purchase_time: parseShopeeDate(row[CSV_COLUMNS.purchaseTime]),
      completed_at: parseShopeeDate(row[CSV_COLUMNS.completedAt]),
      click_time: parseShopeeDate(row[CSV_COLUMNS.clickTime]),
      commission: parseMoney(row[CSV_COLUMNS.commission]),
      net_commission: parseMoney(row[CSV_COLUMNS.netCommission]),
      commission_rate: parsePercent(row[CSV_COLUMNS.commissionRate]),
      sub_id1: subId1 || null,
      sub_id2: clean(row[CSV_COLUMNS.subId2]) || null,
      sub_id3: clean(row[CSV_COLUMNS.subId3]) || null,
      sub_id4: clean(row[CSV_COLUMNS.subId4]) || null,
      sub_id5: clean(row[CSV_COLUMNS.subId5]) || null,
      channel: clean(row[CSV_COLUMNS.channel]) || null,
      matched_affiliate_link_id: matchedLink?.id || null,
      matched_user_id: matchedLink?.user_id || null,
      raw_data: row,
    };
  });

  await insertMany('shopee_conversion_rows', rawRows);

  const matchedRows = rawRows.filter((row) => row.matched_affiliate_link_id && row.matched_user_id && row.shopee_order_id);
  const orderPayloads = aggregateOrders(matchedRows);
  const existingPaidIds = await loadExistingPaidOrderIds(orderPayloads.map((order) => order.shopee_order_id));
  const ordersToUpsert = orderPayloads.map((order) => (
    existingPaidIds.has(order.shopee_order_id)
      ? { ...order, status: 'paid' }
      : order
  ));

  const upsertedOrders = ordersToUpsert.length
    ? await upsert('orders', ordersToUpsert, 'shopee_order_id')
    : [];

  const ledgerPayloads = upsertedOrders
    .filter((order) => order.status !== 'paid')
    .map((order) => ({
      user_id: order.user_id,
      order_id: order.id,
      amount: order.status === 'rejected' ? 0 : Number(order.net_commission || 0),
      status: order.status,
    }));

  if (ledgerPayloads.length) {
    await upsert('commission_ledger', ledgerPayloads, 'order_id');
  }

  const matchedRowCount = rawRows.filter((row) => row.matched_affiliate_link_id).length;
  await updateImport({
    matched_row_count: matchedRowCount,
    unmatched_row_count: rows.length - matchedRowCount,
    normalized_order_count: upsertedOrders.length,
    status: 'completed',
    error_message: null,
  });

  console.log(JSON.stringify({
    import_id: importId,
    filename,
    row_count: rows.length,
    matched_row_count: matchedRowCount,
    unmatched_row_count: rows.length - matchedRowCount,
    normalized_order_count: upsertedOrders.length,
    ledger_count: ledgerPayloads.length,
  }, null, 2));
} catch (error) {
  if (importId) {
    await updateImport({
      status: 'failed',
      error_message: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
  }

  fail(error instanceof Error ? error.message : String(error));
}

function parseCsv(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n' && !inQuotes) {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field || row.length) {
    row.push(field);
    records.push(row);
  }

  const [headers, ...dataRows] = records.filter((record) => record.some((value) => clean(value)));
  if (!headers) return [];

  return dataRows.map((record) => Object.fromEntries(headers.map((header, index) => [clean(header), record[index] ?? ''])));
}

function validateColumns(headers) {
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) {
    fail(`CSV missing required columns: ${missing.join(', ')}`);
  }
}

function aggregateOrders(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = row.shopee_order_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    const itemNames = unique(group.map((row) => row.item_name).filter(Boolean));
    const itemName = itemNames.length > 1 ? `${itemNames[0]} + ${itemNames.length - 1} sản phẩm khác` : itemNames[0] || null;
    const status = mapGroupStatus(group);
    const netCommission = sum(group.map((row) => row.net_commission));

    return {
      shopee_order_id: first.shopee_order_id,
      user_id: first.matched_user_id,
      sub_id: first.sub_id1,
      item_id: first.item_id,
      item_name: itemName,
      checkout_id: first.checkout_id,
      commission: sum(group.map((row) => row.commission)),
      net_commission: status === 'rejected' ? 0 : netCommission,
      commission_rate: first.commission_rate,
      status,
      purchase_time: first.purchase_time,
      completed_at: first.completed_at,
      click_time: first.click_time,
    };
  });
}

function mapGroupStatus(group) {
  const statuses = group.map((row) => row.shopee_status).filter(Boolean);
  if (statuses.includes('Đã hủy')) return 'rejected';
  if (statuses.includes('Đang chờ xử lý')) return 'pending';
  if (statuses.includes('Hoàn thành')) return 'approved';
  return STATUS_MAP.get(statuses[0]) || 'pending';
}

async function loadAffiliateLinks(subIds) {
  const linksBySubId = new Map();
  for (const chunk of chunks(subIds, 80)) {
    if (!chunk.length) continue;
    const rows = await rest('GET', `/affiliate_links?select=id,user_id,sub_id&sub_id=${encodeURIComponent(postgrestIn(chunk))}`);
    for (const row of rows) linksBySubId.set(row.sub_id, row);
  }
  return linksBySubId;
}

async function loadExistingPaidOrderIds(orderIds) {
  const paid = new Set();
  for (const chunk of chunks(unique(orderIds.filter(Boolean)), 80)) {
    if (!chunk.length) continue;
    const rows = await rest('GET', `/orders?select=shopee_order_id,status&status=eq.paid&shopee_order_id=${encodeURIComponent(postgrestIn(chunk))}`);
    for (const row of rows) paid.add(row.shopee_order_id);
  }
  return paid;
}

async function insertOne(table, payload) {
  const rows = await rest('POST', `/${table}`, payload, { prefer: 'return=representation' });
  return rows[0];
}

async function insertMany(table, payloads) {
  for (const chunk of chunks(payloads, 500)) {
    await rest('POST', `/${table}`, chunk);
  }
}

async function upsert(table, payloads, conflictColumn) {
  const results = [];
  for (const chunk of chunks(payloads, 500)) {
    const rows = await rest('POST', `/${table}?on_conflict=${conflictColumn}`, chunk, {
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    results.push(...rows);
  }
  return results;
}

async function updateImport(payload) {
  await rest('PATCH', `/shopee_conversion_imports?id=eq.${importId}`, {
    ...payload,
    updated_at: new Date().toISOString(),
  });
}

async function rest(method, endpoint, body, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1${endpoint}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
      ...(options.prefer ? { prefer: options.prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${method} ${endpoint} failed: ${response.status} ${message}`);
  }

  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

function postgrestIn(values) {
  return `in.(${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(',')})`;
}

function parseMoney(value) {
  const cleaned = normalizeNumberText(value);
  if (!cleaned || cleaned === '--') return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePercent(value) {
  const cleaned = normalizeNumberText(value);
  if (!cleaned || cleaned === '--') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNumberText(value) {
  let cleaned = clean(value).replace(/[₫%\s]/g, '');
  if (!cleaned || cleaned === '--') return cleaned;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      return cleaned.replace(/\./g, '').replace(',', '.');
    }
    return cleaned.replace(/,/g, '');
  }

  if (hasComma) {
    return cleaned.replace(',', '.');
  }

  if (hasDot) {
    const parts = cleaned.split('.');
    const last = parts.at(-1) || '';
    if (parts.length > 2 && last.length === 3) {
      return cleaned.replace(/\./g, '');
    }
  }

  return cleaned;
}

function parseShopeeDate(value) {
  const cleaned = clean(value);
  if (!cleaned || cleaned === '--') return null;
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+07:00`;
}

function clean(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values)];
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function sum(values) {
  return Number(values.reduce((total, value) => total + Number(value || 0), 0).toFixed(2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
