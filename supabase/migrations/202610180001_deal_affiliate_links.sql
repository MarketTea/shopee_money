-- ═══════════════════════════════════════════════════
-- DEAL AFFILIATE TRACKING & CONVERSION - Migration
-- Hỗ trợ Mô hình A: Chia hoa hồng cho user khi săn deal hot
-- ═══════════════════════════════════════════════════

-- 1. Thêm cột click_count cho deal_products để theo dõi độ hot của deal
alter table public.deal_products 
  add column if not exists click_count int not null default 0;

-- 2. Thêm RLS policy cho phép authenticated user insert affiliate_links của chính mình
drop policy if exists "Users can insert their own affiliate links" on public.affiliate_links;
create policy "Users can insert their own affiliate links"
  on public.affiliate_links for insert
  with check (auth.uid() = user_id);

-- 3. Thêm RLS policy cho phép authenticated user insert clicks của chính mình
drop policy if exists "Users can insert their own clicks" on public.clicks;
create policy "Users can insert their own clicks"
  on public.clicks for insert
  with check (auth.uid() = user_id);

-- 4. RPC function: generate_deal_affiliate_link
-- Tự động sinh sub_id chuẩn (u_<userId>_l_<linkId>), lưu vào affiliate_links,
-- tăng click_count và trả về link redirect Shopee gắn affiliate_id của Admin
create or replace function public.generate_deal_affiliate_link(
  p_product_id uuid,
  p_affiliate_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_product record;
  v_link_id uuid;
  v_sub_id text;
  v_clean_user text;
  v_clean_link text;
  v_final_affiliate_url text;
  v_affiliate_id text := '17305840167';
begin
  -- Lấy user id hiện tại từ session
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Vui lòng đăng nhập để tạo link hoàn tiền';
  end if;

  -- Tìm sản phẩm deal
  select p.*, c.title as campaign_title
  into v_product
  from public.deal_products p
  join public.deal_campaigns c on c.id = p.campaign_id
  where p.id = p_product_id and c.is_active = true;

  if not found then
    raise exception 'Không tìm thấy sản phẩm deal hoặc campaign đã kết thúc';
  end if;

  -- Tăng số lượt click của sản phẩm
  update public.deal_products
  set click_count = click_count + 1
  where id = p_product_id;

  -- Tạo link_id và sub_id duy nhất cho user này
  v_link_id := gen_random_uuid();
  v_clean_user := substring(replace(v_user_id::text, '-', ''), 1, 8);
  v_clean_link := substring(replace(v_link_id::text, '-', ''), 1, 8);
  v_sub_id := 'u_' || v_clean_user || '_l_' || v_clean_link;

  -- Nếu client truyền link affiliate đã encode sẵn thì dùng, ngược lại tự ráp link Shopee redirect
  if p_affiliate_url is not null and p_affiliate_url <> '' then
    v_final_affiliate_url := p_affiliate_url;
  else
    v_final_affiliate_url := 'https://s.shopee.vn/an_redir?origin_link=' || 
      replace(replace(replace(v_product.affiliate_url, ':', '%3A'), '/', '%2F'), '?', '%3F') ||
      '&affiliate_id=' || v_affiliate_id || 
      '&sub_id=' || v_sub_id;
  end if;

  -- Ghi nhận vào bảng affiliate_links
  insert into public.affiliate_links (
    id,
    user_id,
    original_url,
    normalized_url,
    sub_id,
    affiliate_url,
    product_name
  ) values (
    v_link_id,
    v_user_id,
    v_product.affiliate_url,
    v_product.affiliate_url,
    v_sub_id,
    v_final_affiliate_url,
    v_product.name
  );

  -- Ghi nhận lượt click
  insert into public.clicks (
    affiliate_link_id,
    user_id
  ) values (
    v_link_id,
    v_user_id
  );

  return jsonb_build_object(
    'id', v_link_id,
    'sub_id', v_sub_id,
    'affiliate_url', v_final_affiliate_url,
    'product_name', v_product.name,
    'click_count', v_product.click_count + 1
  );
end;
$$;
