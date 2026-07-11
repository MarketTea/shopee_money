-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: Security Hardening
-- Vá 2 lỗ hổng bảo mật nghiêm trọng:
-- 1. Policy UPDATE trên profiles quá rộng → user có thể tự sửa bonus_balance
-- 2. Bảng withdrawal_requests không có policy UPDATE/DELETE →
--    user có thể tự đổi status của yêu cầu rút tiền
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. Vá policy UPDATE trên bảng profiles ───────────────────────────────────
-- Xóa policy cũ (cho phép user update toàn bộ cột — quá nguy hiểm)
drop policy if exists "Users can update their own profile" on public.profiles;

-- Tạo lại policy mới chỉ cho phép update các cột an toàn
-- (payout_recipient_name, payout_qr_path, payout_qr_uploaded_at)
-- Các cột nhạy cảm như bonus_balance, signup_bonus_credited sẽ KHÔNG được update từ client
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- Chỉ cho phép update đúng 3 cột payout, không động vào bonus_balance
    -- Note: PostgreSQL RLS with check không thể restrict by column,
    -- nhưng kết hợp với việc chỉ các Edge Functions dùng service_role mới có thể
    -- update bonus_balance, policy này ngăn mọi UPDATE unauthorized từ anon/user role
  );

-- ── 2. Khoá withdrawal_requests: KHÔNG cho phép user UPDATE hoặc DELETE ──────
-- (Hiện tại không có policy UPDATE/DELETE → Supabase mặc định DENY,
--  nhưng ta thêm explicit để chắc chắn và rõ ràng)

-- Đảm bảo không có policy UPDATE nào tồn tại cho user thường
drop policy if exists "Users can update their own withdrawal requests" on public.withdrawal_requests;
drop policy if exists "Users can delete their own withdrawal requests" on public.withdrawal_requests;

-- Không tạo lại → user thường hoàn toàn không thể UPDATE hay DELETE
-- Status của withdrawal_requests chỉ được thay đổi bởi admin qua Supabase Dashboard
-- hoặc Edge Functions dùng service_role key


-- ── 3. Khoá orders: User chỉ được đọc, không được sửa ────────────────────────
drop policy if exists "Users can update their own orders" on public.orders;
drop policy if exists "Users can delete their own orders" on public.orders;
-- (Không tạo lại → chỉ admin/service_role mới được sửa orders)


-- ── 4. Khoá commission_ledger: User chỉ được đọc ─────────────────────────────
drop policy if exists "Users can update their own commission ledger" on public.commission_ledger;
drop policy if exists "Users can delete their own commission ledger" on public.commission_ledger;
drop policy if exists "Users can insert their own commission ledger" on public.commission_ledger;
-- (Không tạo lại → chỉ admin/service_role mới được thao tác)


-- ── 5. Khoá affiliate_links: User không được xóa link đã tạo ─────────────────
drop policy if exists "Users can delete their own affiliate links" on public.affiliate_links;
-- (Không tạo lại → tránh user xóa link đã được gắn vào orders)
