-- ═══════════════════════════════════════════════════
-- DEAL HOT CAMPAIGNS - Migration
-- Bảng lưu các chiến dịch deal và sản phẩm
-- ═══════════════════════════════════════════════════

-- Bảng campaign (chiến dịch deal theo thương hiệu)
create table if not exists public.deal_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  brand text,
  category text default 'Khác',   -- 'Beauty', 'Fashion', 'Tech', 'Food', 'Voucher', 'Khác'
  start_date date,
  end_date date,
  highlights text[],               -- ["HOA HỒNG 14%", "VOUCHER XẢ LÁNG"]
  voucher_codes jsonb default '[]'::jsonb,  -- [{"code": "LIXI1010", "desc": "Giảm 150K"}]
  store_url text,                  -- Link official store
  raw_content text,                -- Nội dung gốc để backup/audit
  is_active boolean default true,
  sort_order int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bảng sản phẩm trong campaign
create table if not exists public.deal_products (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.deal_campaigns(id) on delete cascade,
  name text not null,
  description text,                -- Mô tả ngắn / chi tiết quà tặng
  affiliate_url text not null,
  discount_label text,             -- "Giảm 45K", "Giảm 20%", "[KOL]"
  has_gift boolean default false,
  gift_description text,           -- Mô tả quà tặng (nếu có)
  sort_order int default 0,
  created_at timestamptz not null default now()
);

-- Indexes để tăng tốc query
create index if not exists deal_campaigns_active_end_idx
  on public.deal_campaigns (is_active, end_date desc, created_at desc);

create index if not exists deal_campaigns_category_idx
  on public.deal_campaigns (category);

create index if not exists deal_products_campaign_idx
  on public.deal_products (campaign_id, sort_order);

-- Trigger tự cập nhật updated_at
create or replace function public.handle_deal_campaign_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_deal_campaign_updated on public.deal_campaigns;
create trigger on_deal_campaign_updated
  before update on public.deal_campaigns
  for each row execute procedure public.handle_deal_campaign_updated();

-- ══ ROW LEVEL SECURITY ══
alter table public.deal_campaigns enable row level security;
alter table public.deal_products enable row level security;

-- PUBLIC: Ai cũng có thể đọc các campaign đang active
drop policy if exists "Public can read active campaigns" on public.deal_campaigns;
create policy "Public can read active campaigns"
  on public.deal_campaigns for select
  using (is_active = true);

drop policy if exists "Public can read products of active campaigns" on public.deal_products;
create policy "Public can read products of active campaigns"
  on public.deal_products for select
  using (
    exists (
      select 1 from public.deal_campaigns c
      where c.id = deal_products.campaign_id
        and c.is_active = true
    )
  );

-- ADMIN: Cho phép service_role và authenticated users quản lý campaigns & products từ trang Admin
drop policy if exists "Admin can manage campaigns" on public.deal_campaigns;
create policy "Admin can manage campaigns"
  on public.deal_campaigns for all
  using (auth.role() = 'service_role' or auth.role() = 'authenticated')
  with check (auth.role() = 'service_role' or auth.role() = 'authenticated');

drop policy if exists "Admin can manage products" on public.deal_products;
create policy "Admin can manage products"
  on public.deal_products for all
  using (auth.role() = 'service_role' or auth.role() = 'authenticated')
  with check (auth.role() = 'service_role' or auth.role() = 'authenticated');

