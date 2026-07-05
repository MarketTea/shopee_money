-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: Signup bonus 20.000đ cho user mới đăng nhập lần đầu
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Thêm 2 cột mới vào bảng profiles
alter table public.profiles
  add column if not exists bonus_balance     numeric(12, 2) not null default 0,
  add column if not exists signup_bonus_credited boolean not null default false;

-- 2. Cập nhật trigger handle_new_user để tự động credit bonus cho user mới
--    (user_metadata.sub xác định đây là lần tạo user lần đầu)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, bonus_balance, signup_bonus_credited)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    20000,   -- bonus 20.000đ cho user mới
    true
  )
  on conflict (id) do update set
    email      = excluded.email,
    full_name  = excluded.full_name,
    avatar_url = excluded.avatar_url;
  -- Lưu ý: on conflict KHÔNG cập nhật bonus_balance / signup_bonus_credited
  -- để tránh reset bonus của user cũ khi họ đăng nhập lại

  return new;
end;
$$;

-- 3. Đảm bảo trigger vẫn chạy đúng (drop & recreate nếu đã có)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. Đảm bảo RLS cho phép user đọc bonus_balance (đã có policy select trước đó)
-- Không cần thêm policy mới vì đã có "Users can read their own profile"
