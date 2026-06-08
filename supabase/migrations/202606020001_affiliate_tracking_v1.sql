create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  original_url text not null,
  normalized_url text not null,
  sub_id text not null unique,
  affiliate_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.clicks (
  id uuid primary key default gen_random_uuid(),
  affiliate_link_id uuid not null references public.affiliate_links(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  ip_hash text,
  user_agent text
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  shopee_order_id text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sub_id text not null references public.affiliate_links(sub_id) on delete restrict,
  item_id text,
  item_name text,
  commission numeric(12, 2) not null default 0,
  net_commission numeric(12, 2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  purchase_time timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.commission_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric(12, 2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  created_at timestamptz not null default now(),
  unique (order_id)
);

create index if not exists affiliate_links_user_created_idx on public.affiliate_links (user_id, created_at desc);
create index if not exists affiliate_links_sub_id_idx on public.affiliate_links (sub_id);
create index if not exists clicks_user_clicked_idx on public.clicks (user_id, clicked_at desc);
create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
create index if not exists orders_sub_id_idx on public.orders (sub_id);
create index if not exists commission_ledger_user_created_idx on public.commission_ledger (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.affiliate_links enable row level security;
alter table public.clicks enable row level security;
alter table public.orders enable row level security;
alter table public.commission_ledger enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Users can read their own affiliate links" on public.affiliate_links;
create policy "Users can read their own affiliate links"
  on public.affiliate_links for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read their own clicks" on public.clicks;
create policy "Users can read their own clicks"
  on public.clicks for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read their own orders" on public.orders;
create policy "Users can read their own orders"
  on public.orders for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read their own commission ledger" on public.commission_ledger;
create policy "Users can read their own commission ledger"
  on public.commission_ledger for select
  using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute procedure public.handle_new_user();
