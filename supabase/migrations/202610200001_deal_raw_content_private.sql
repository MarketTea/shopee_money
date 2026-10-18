-- ═══════════════════════════════════════════════════════════════════════════
-- 202610200001_deal_raw_content_private.sql
--
-- S3: `deal_campaigns.raw_content` là nội dung text gốc copy từ group KOL
-- (có thể chứa ghi chú nội bộ, mức hoa hồng, thông tin riêng). Trước đây
-- policy "Public can read active campaigns" cho phép đọc TOÀN BỘ cột, nên
-- bất kỳ ai có anon key đều `GET /rest/v1/deal_campaigns?select=*` và đọc được.
--
-- Cách vá: thu hồi SELECT mức bảng, chỉ grant SELECT mức CỘT cho các cột
-- được phép công khai. `raw_content` vẫn được INSERT/UPDATE bởi admin,
-- nhưng không đọc được qua API client (chỉ đọc qua SQL Editor / service_role).
--
-- LƯU Ý KHI BẢO TRÌ: nếu thêm cột mới vào bảng này và muốn client đọc được,
-- phải grant thêm:
--   grant select (ten_cot) on public.deal_campaigns to anon, authenticated;
-- ═══════════════════════════════════════════════════════════════════════════

do $do$
declare
  public_columns constant text :=
    'id, title, brand, category, start_date, end_date, highlights, '
    'voucher_codes, store_url, is_active, sort_order, created_at, updated_at';
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke select on table public.deal_campaigns from %I', role_name);
      execute format(
        'grant select (%s) on table public.deal_campaigns to %I',
        public_columns, role_name
      );
    end if;
  end loop;
end
$do$;

-- Kiểm tra nhanh (chạy tay nếu cần):
--   select has_column_privilege('anon', 'public.deal_campaigns', 'raw_content', 'select');   -- false
--   select has_column_privilege('anon', 'public.deal_campaigns', 'title', 'select');         -- true
--   select has_column_privilege('authenticated', 'public.deal_campaigns', 'raw_content', 'select'); -- false

notify pgrst, 'reload schema';
