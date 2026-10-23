-- ═══════════════════════════════════════════════════════════════════════════
-- 202610230001_deal_action_links.sql
--
-- Bài post từ group KOC thường trộn 2 loại link:
--   1. link sản phẩm  → deal_products           (đã có)
--   2. link sự kiện / kho voucher / bộ sưu tập (vd: /m/..., /user/voucher-wallet/,
--      /<shop>?shopCollection=<id>) → KHÔNG có chỗ lưu trước đây, nên khi publish
--      các campaign chỉ có loại link này hiển thị ra trang deals nhưng KHÔNG có
--      nút bấm nào (parser bóc được mà DB nuốt mất).
--
-- Thêm cột action_links jsonb: [{ "label": "...", "url": "...", "cta_label": "..." }]
-- URL được lưu ở dạng GỐC; client bọc affiliate redirect lúc user click
-- (deals.js: openEventLinkWithAffiliate) nên affiliate_id/sub_id luôn do
-- client sinh tại thời điểm click, không lưu sub_id vào DB.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.deal_campaigns
  add column if not exists action_links jsonb not null default '[]'::jsonb;

comment on column public.deal_campaigns.action_links is
  'CTA sự kiện/voucher/bộ sưu tập: [{"label","url","cta_label"}]. URL gốc, client bọc affiliate redirect khi click.';

-- Chỉ cho phép mảng JSON (tránh object/string làm vỡ render).
do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deal_campaigns'::regclass
      and conname = 'deal_campaigns_action_links_is_array'
  ) then
    alter table public.deal_campaigns
      add constraint deal_campaigns_action_links_is_array
      check (jsonb_typeof(action_links) = 'array') not valid;
  end if;
end
$do$;

-- `raw_content` đã bị thu hồi SELECT mức bảng (202610200001) nên cột mới
-- BẮT BUỘC phải grant mức cột, nếu không client select sẽ bị 403/42703.
do $do$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'grant select (action_links) on table public.deal_campaigns to %I',
        role_name
      );
    end if;
  end loop;
end
$do$;

-- Kiểm tra nhanh (chạy tay nếu cần):
--   select has_column_privilege('anon', 'public.deal_campaigns', 'action_links', 'select');       -- true
--   select has_column_privilege('anon', 'public.deal_campaigns', 'raw_content', 'select');        -- false

notify pgrst, 'reload schema';
