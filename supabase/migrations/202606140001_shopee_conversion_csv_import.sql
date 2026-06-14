alter table public.orders
  add column if not exists commission_rate numeric(5, 2),
  add column if not exists completed_at timestamptz,
  add column if not exists click_time timestamptz,
  add column if not exists checkout_id text;

create table if not exists public.shopee_conversion_imports (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  row_count integer not null default 0,
  matched_row_count integer not null default 0,
  unmatched_row_count integer not null default 0,
  normalized_order_count integer not null default 0,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shopee_conversion_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.shopee_conversion_imports(id) on delete cascade,
  row_number integer not null,
  shopee_order_id text,
  checkout_id text,
  item_id text,
  model_id text,
  shopee_status text,
  item_name text,
  purchase_time timestamptz,
  completed_at timestamptz,
  click_time timestamptz,
  commission numeric(12, 2),
  net_commission numeric(12, 2),
  commission_rate numeric(5, 2),
  sub_id1 text,
  sub_id2 text,
  sub_id3 text,
  sub_id4 text,
  sub_id5 text,
  channel text,
  matched_affiliate_link_id uuid references public.affiliate_links(id) on delete set null,
  matched_user_id uuid references public.profiles(id) on delete set null,
  raw_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (import_id, row_number)
);

create index if not exists shopee_conversion_rows_import_idx
  on public.shopee_conversion_rows (import_id, row_number);

create index if not exists shopee_conversion_rows_order_idx
  on public.shopee_conversion_rows (shopee_order_id);

create index if not exists shopee_conversion_rows_sub_id1_idx
  on public.shopee_conversion_rows (sub_id1);

alter table public.shopee_conversion_imports enable row level security;
alter table public.shopee_conversion_rows enable row level security;
