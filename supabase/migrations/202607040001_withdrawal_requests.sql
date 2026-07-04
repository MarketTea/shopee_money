-- Bảng lưu lịch sử rút tiền của user
create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12, 2) not null default 0,
  -- Danh sách order_id đã được tính vào lần rút này (snapshot tránh tính trùng)
  order_ids uuid[] not null default '{}',
  -- Tổng net_commission của các đơn (trước khi chia 2)
  total_net_commission numeric(12, 2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists withdrawal_requests_user_created_idx
  on public.withdrawal_requests (user_id, created_at desc);

alter table public.withdrawal_requests enable row level security;

-- User chỉ đọc được yêu cầu của chính mình
drop policy if exists "Users can read their own withdrawal requests" on public.withdrawal_requests;
create policy "Users can read their own withdrawal requests"
  on public.withdrawal_requests for select
  using (auth.uid() = user_id);

-- User có thể tạo yêu cầu rút tiền cho chính mình
drop policy if exists "Users can insert their own withdrawal requests" on public.withdrawal_requests;
create policy "Users can insert their own withdrawal requests"
  on public.withdrawal_requests for insert
  with check (auth.uid() = user_id);
