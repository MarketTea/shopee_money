-- ═══════════════════════════════════════════════════════════════════════════
-- 202610190001_deal_hardening.sql
--
-- Vá các lỗi blocker/major của tính năng Deal Hot:
--   S1  RLS "auth.role() = 'authenticated'" → bất kỳ user đăng nhập nào cũng
--       sửa/xoá được campaign & product  →  thay bằng bảng deal_admins.
--   C1  sub_id trong link Shopee khác sub_id lưu DB → CSV import không match
--       →  không bao giờ có hoàn tiền. Server tự dựng URL từ chính sub_id
--       mà nó lưu, và thêm CHECK constraint chặn tái diễn.
--   S2  RPC tin tưởng p_affiliate_url do client gửi (đổi affiliate_id /
--       open redirect)  →  bỏ hẳn tham số URL khỏi RPC.
--   S5  Không giới hạn tần suất ghi affiliate_links/clicks  →  tái sử dụng
--       link trong 30 phút + dedupe clicks 60 giây.
--   S6  SECURITY DEFINER thiếu REVOKE / search_path  →  siết lại.
--   S9  Encode origin_link thiếu & # = %  →  hàm deal_url_encode().
--   C5  RPC vẫn tạo link cho deal đã hết hạn  →  check end_date.
--   C6  Guest mua hàng (sub_id = deal_guest) không có row nào trong
--       affiliate_links  →  seed 1 row thuộc admin.
--   C2  Parser có thể sinh ngày sai  →  CHECK constraint chặn ở DB.
--   P3  Index không phục vụ ORDER BY end_date ASC  →  index mới.
--
-- Idempotent: chạy lại nhiều lần không lỗi.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Bảng admin thật (nguồn sự thật cho phân quyền) ───────────────────────
create table if not exists public.deal_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table public.deal_admins enable row level security;

-- Không tạo policy nào: client (anon/authenticated) không đọc/ghi trực tiếp được.
-- Chỉ service_role (dashboard, script, edge function) và hàm SECURITY DEFINER bên dưới.
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.deal_admins from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.deal_admins from authenticated';
  end if;
end
$do$;

-- Hàm kiểm tra admin: SECURITY DEFINER để policy đọc được deal_admins
-- (subquery trong policy chạy bằng quyền của caller nên RLS sẽ chặn nếu đọc trực tiếp).
create or replace function public.is_deal_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.deal_admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_deal_admin() from public;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.is_deal_admin() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.is_deal_admin() to authenticated';
  end if;
end
$do$;

-- Seed admin hiện tại (đổi email ở đây nếu cần thêm người).
insert into public.deal_admins (user_id, note)
select u.id, 'seed: ' || u.email
from auth.users u
where lower(u.email) = 'nducthien96@gmail.com'
on conflict (user_id) do nothing;

-- ── 2. RLS: chỉ admin thật mới được ghi ─────────────────────────────────────
-- Gỡ 2 policy quá rộng của migration 20261017
drop policy if exists "Admin can manage campaigns" on public.deal_campaigns;
drop policy if exists "Admin can manage products"  on public.deal_products;

-- (Giữ nguyên policy public read: "Public can read active campaigns" /
--  "Public can read products of active campaigns")

drop policy if exists "Deal admins can read all campaigns"   on public.deal_campaigns;
drop policy if exists "Deal admins can insert campaigns"     on public.deal_campaigns;
drop policy if exists "Deal admins can update campaigns"     on public.deal_campaigns;
drop policy if exists "Deal admins can delete campaigns"     on public.deal_campaigns;
drop policy if exists "Deal admins can read all products"    on public.deal_products;
drop policy if exists "Deal admins can insert products"      on public.deal_products;
drop policy if exists "Deal admins can update products"      on public.deal_products;
drop policy if exists "Deal admins can delete products"      on public.deal_products;

create policy "Deal admins can read all campaigns"
  on public.deal_campaigns for select to authenticated
  using (public.is_deal_admin());

create policy "Deal admins can insert campaigns"
  on public.deal_campaigns for insert to authenticated
  with check (public.is_deal_admin());

create policy "Deal admins can update campaigns"
  on public.deal_campaigns for update to authenticated
  using (public.is_deal_admin())
  with check (public.is_deal_admin());

create policy "Deal admins can delete campaigns"
  on public.deal_campaigns for delete to authenticated
  using (public.is_deal_admin());

create policy "Deal admins can read all products"
  on public.deal_products for select to authenticated
  using (public.is_deal_admin());

create policy "Deal admins can insert products"
  on public.deal_products for insert to authenticated
  with check (public.is_deal_admin());

create policy "Deal admins can update products"
  on public.deal_products for update to authenticated
  using (public.is_deal_admin())
  with check (public.is_deal_admin());

create policy "Deal admins can delete products"
  on public.deal_products for delete to authenticated
  using (public.is_deal_admin());

-- ── 2b. Bỏ quyền ghi trực tiếp từ client vào affiliate_links / clicks ───────
-- Client KHÔNG còn tự insert (fallback đã bị bỏ trong deals.js).
-- Chỉ RPC SECURITY DEFINER / edge function (service role) được ghi.
-- Nhờ vậy user không thể tự tạo link giả (sub_id / product_name tuỳ ý).
drop policy if exists "Users can insert their own affiliate links" on public.affiliate_links;
drop policy if exists "Users can insert their own clicks" on public.clicks;

-- ── 3. Ràng buộc dữ liệu (chặn ngày sai từ parser) ──────────────────────────
-- NOT VALID: chỉ áp dụng cho row mới, không làm fail migration vì dữ liệu cũ.
do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'deal_campaigns_date_chk'
      and conrelid = 'public.deal_campaigns'::regclass
  ) then
    alter table public.deal_campaigns
      add constraint deal_campaigns_date_chk
      check (start_date is null or end_date is null or end_date >= start_date)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'deal_campaigns_category_chk'
      and conrelid = 'public.deal_campaigns'::regclass
  ) then
    alter table public.deal_campaigns
      add constraint deal_campaigns_category_chk
      check (
        category is null or category in ('Beauty', 'Fashion', 'Tech', 'Food', 'Voucher', 'Khác')
      )
      not valid;
  end if;
end
$do$;

-- ── 4. Index phục vụ đúng thứ tự sort của trang public ──────────────────────
-- Query: where is_active = true order by end_date asc, created_at desc
drop index if exists public.deal_campaigns_active_end_idx;
create index if not exists deal_campaigns_public_sort_idx
  on public.deal_campaigns (is_active, end_date asc, created_at desc);

-- ── 5. Hàm encode URL dùng chung cho server ─────────────────────────────────
-- Encode % TRƯỚC, sau đó mới encode các ký tự khác (tránh double-encode).
create or replace function public.deal_url_encode(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(
           coalesce(p_value, ''),
           '%', '%25'),
           ' ', '%20'),
           '#', '%23'),
           '&', '%26'),
           '+', '%2B'),
           '?', '%3F'),
           '=', '%3D'),
           '/', '%2F'),
           ':', '%3A');
$$;

revoke all on function public.deal_url_encode(text) from public;

-- ── 6. RPC tạo link hoàn tiền — server là single source of truth ─────────────
-- Bỏ hoàn toàn tham số URL do client gửi. Server tự sinh link_id + sub_id và
-- tự dựng affiliate_url từ đúng 2 giá trị đó ⇒ sub_id trong link LUÔN khớp
-- với sub_id lưu DB ⇒ CSV import của Shopee match được.
drop function if exists public.generate_deal_affiliate_link(uuid, text);
drop function if exists public.generate_deal_affiliate_link(uuid);

create or replace function public.generate_deal_affiliate_link(
  p_product_id uuid,
  p_link_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_affiliate_id constant text := '17305840167';
  c_reuse_window constant interval := interval '30 minutes';
  c_click_dedupe constant interval := interval '60 seconds';

  v_user_id  uuid := auth.uid();
  v_product  public.deal_products%rowtype;
  v_link_id  uuid;
  v_sub_id   text;
  v_origin   text;
  v_url      text;
  v_reused   boolean := false;
  v_clicks   int;
begin
  if v_user_id is null then
    raise exception 'Vui lòng đăng nhập để tạo link hoàn tiền'
      using errcode = '42501';
  end if;

  -- Chỉ sản phẩm thuộc campaign đang bật VÀ còn hạn (C5)
  select p.* into v_product
  from public.deal_products p
  join public.deal_campaigns c on c.id = p.campaign_id
  where p.id = p_product_id
    and c.is_active
    and (c.end_date is null or c.end_date >= current_date);

  if not found then
    raise exception 'Không tìm thấy sản phẩm deal hoặc campaign đã kết thúc'
      using errcode = 'P0002';
  end if;

  v_origin := coalesce(nullif(v_product.affiliate_url, ''), '');

  if v_origin !~* '^https://([a-z0-9-]+\.)*(shopee\.vn|shope\.ee|shp\.ee)/' then
    raise exception 'Link sản phẩm không hợp lệ'
      using errcode = '22023';
  end if;

  -- Tái sử dụng link cũ (cùng user + cùng sản phẩm + trong 30 phút) để
  -- chống spam ghi DB và giữ sub_id ổn định cho user (S5)
  select l.id, l.sub_id, l.affiliate_url
    into v_link_id, v_sub_id, v_url
  from public.affiliate_links l
  where l.user_id = v_user_id
    and l.original_url = v_origin
    and l.created_at > now() - c_reuse_window
    -- chỉ tái sử dụng link còn thoả invariant (tránh reuse row cũ bị lệch sub_id)
    and l.affiliate_url like '%sub_id=' || l.sub_id || '%'
  order by l.created_at desc
  limit 1;

  if found then
    v_reused := true;
  else
    v_link_id := coalesce(p_link_id, gen_random_uuid());
    v_sub_id  := 'u_' || left(replace(v_user_id::text, '-', ''), 8)
                      || '_l_' || left(replace(v_link_id::text, '-', ''), 8);
    v_url     := 'https://s.shopee.vn/an_redir?origin_link='
                 || public.deal_url_encode(v_origin)
                 || '&affiliate_id=' || c_affiliate_id
                 || '&sub_id='       || v_sub_id;

    insert into public.affiliate_links (
      id, user_id, original_url, normalized_url, sub_id, affiliate_url, product_name
    ) values (
      v_link_id, v_user_id, v_origin, v_origin, v_sub_id, v_url, v_product.name
    );
  end if;

  update public.deal_products
     set click_count = click_count + 1
   where id = p_product_id
  returning click_count into v_clicks;

  -- Ghi nhận click, dedupe 60 giây/link để không phình bảng clicks
  if not exists (
    select 1 from public.clicks c
    where c.affiliate_link_id = v_link_id
      and c.clicked_at > now() - c_click_dedupe
  ) then
    insert into public.clicks (affiliate_link_id, user_id)
    values (v_link_id, v_user_id);
  end if;

  return jsonb_build_object(
    'id', v_link_id,
    'sub_id', v_sub_id,
    'affiliate_url', v_url,
    'product_name', v_product.name,
    'click_count', coalesce(v_clicks, 1),
    'reused', v_reused
  );
end;
$$;

revoke all on function public.generate_deal_affiliate_link(uuid, uuid) from public;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.generate_deal_affiliate_link(uuid, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.generate_deal_affiliate_link(uuid, uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.generate_deal_affiliate_link(uuid, uuid) to service_role';
  end if;
end
$do$;

comment on function public.generate_deal_affiliate_link(uuid, uuid) is
  'Tạo (hoặc tái sử dụng) link affiliate cho 1 deal product. Server tự sinh sub_id = u_<8>_l_<8> và tự dựng affiliate_url, KHÔNG tin URL từ client.';

-- ── 7. Invariant: sub_id phải xuất hiện trong affiliate_url ─────────────────
-- Chặn vĩnh viễn lỗi C1 (sub_id lưu DB ≠ sub_id trong link).
do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'affiliate_links_sub_id_in_url'
      and conrelid = 'public.affiliate_links'::regclass
  ) then
    alter table public.affiliate_links
      add constraint affiliate_links_sub_id_in_url
      check (affiliate_url like '%sub_id=' || sub_id || '%')
      not valid;
  end if;
end
$do$;

-- ── 8. Seed link cho khách vãng lai (sub_id = deal_guest) ───────────────────
-- Nhờ vậy đơn của khách chưa đăng nhập vẫn được import và ghi công cho admin
-- thay vì bị coi là "unmatched" như trước (C6).
do $do$
declare
  v_admin uuid;
begin
  select user_id into v_admin
  from public.deal_admins
  order by created_at
  limit 1;

  if v_admin is null then
    raise notice 'Chưa có public.deal_admins → bỏ qua seed deal_guest.';
    return;
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_admin) then
    raise notice 'Admin chưa có profile → bỏ qua seed deal_guest.';
    return;
  end if;

  insert into public.affiliate_links (
    id, user_id, original_url, normalized_url, sub_id, affiliate_url, product_name
  ) values (
    gen_random_uuid(),
    v_admin,
    'https://shopee.vn/',
    'https://shopee.vn/',
    'deal_guest',
    'https://s.shopee.vn/an_redir?origin_link=https%3A%2F%2Fshopee.vn%2F'
      || '&affiliate_id=17305840167&sub_id=deal_guest',
    'Deal Hot — khách vãng lai'
  )
  on conflict (sub_id) do nothing;
end
$do$;

commit;

-- PostgREST cần reload để nhận function signature mới.
notify pgrst, 'reload schema';
