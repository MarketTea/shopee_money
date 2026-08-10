-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: Referral Program — Giới thiệu bạn bè
-- Referrer nhận 5.000đ, Referred nhận 2.000đ khi đơn đầu tiên approved
-- Giới hạn: 15 lượt reward / referrer / tháng
-- ──────────────────────────────────────────────────────────────────────────────

-- ─── 1. Thêm cột vào bảng profiles ───────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code         text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by_user_id  uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS referral_reward_count integer NOT NULL DEFAULT 0;

-- ─── 2. Thêm cột vào bảng orders ─────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS referral_reward_granted boolean NOT NULL DEFAULT false;

-- ─── 3. Tạo bảng referrals ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id          uuid        NOT NULL REFERENCES public.profiles(id),
  referred_id          uuid        NOT NULL REFERENCES public.profiles(id),
  referral_code_used   text        NOT NULL,
  status               text        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'rewarded', 'clawed_back', 'invalid')),
  
  referrer_reward      numeric(12,2) NOT NULL DEFAULT 5000,
  referred_reward      numeric(12,2) NOT NULL DEFAULT 2000,

  rewarded_at          timestamptz,
  clawed_back_at       timestamptz,
  triggering_order_id  uuid REFERENCES public.orders(id),
  clawback_order_id    uuid REFERENCES public.orders(id),

  -- Anti-fraud metadata
  referred_ip          text,
  created_at           timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  UNIQUE (referred_id),
  CONSTRAINT no_self_referral CHECK (referrer_id != referred_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id);
CREATE INDEX IF NOT EXISTS referrals_status_idx   ON public.referrals (status);

-- ─── 4. RLS cho bảng referrals ───────────────────────────────────────────────
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Referrer can read their referrals" ON public.referrals;
CREATE POLICY "Referrer can read their referrals"
  ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_id);

-- ─── 5. Hàm generate_referral_code ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars  text    := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text    := '';
  i      integer := 0;
  attempt integer := 0;
  code_exists boolean;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..7 LOOP
      result := result || substr(chars, floor(random() * length(chars))::int + 1, 1);
    END LOOP;

    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE referral_code = result) INTO code_exists;
    EXIT WHEN NOT code_exists;

    attempt := attempt + 1;
    IF attempt > 10 THEN
      RAISE EXCEPTION 'Cannot generate unique referral code after 10 attempts';
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- ─── 6. Cập nhật trigger handle_new_user ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, avatar_url,
    bonus_balance, signup_bonus_credited, referral_code
  )
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    20000,
    true,
    public.generate_referral_code()
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = excluded.email,
    full_name  = excluded.full_name,
    avatar_url = excluded.avatar_url;

  RETURN new;
END;
$$;

-- Drop trigger cũ nếu có và tạo lại để chắc chắn áp dụng
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ─── 7. BACKFILL referral code cho user cũ ───────────────────────────────────
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT id FROM public.profiles WHERE referral_code IS NULL LOOP
    UPDATE public.profiles SET referral_code = public.generate_referral_code() WHERE id = rec.id;
  END LOOP;
END;
$$;

-- ─── 8. RPC: apply_referral ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_referral(
  p_referral_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_referrer_id uuid;
  v_referrer_name text;
  v_referred_id uuid;
  v_referred_by_user_id uuid;
  v_created_at timestamptz;
BEGIN
  -- Lấy user hiện tại đang gọi RPC
  v_referred_id := auth.uid();
  IF v_referred_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- Kiểm tra user có tồn tại và thông tin cần thiết
  SELECT referred_by_user_id, (SELECT created_at FROM auth.users WHERE id = v_referred_id) 
  INTO v_referred_by_user_id, v_created_at
  FROM public.profiles 
  WHERE id = v_referred_id;

  -- Nếu không tìm thấy profile, return lỗi (mặc dù hiếm xảy ra)
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Tài khoản không tồn tại');
  END IF;

  -- Check user cũ đã nhập mã chưa
  IF v_referred_by_user_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'Bạn đã nhập mã giới thiệu rồi');
  END IF;

  -- Check điều kiện user mới (tạo tài khoản trong vòng 24h)
  IF now() - v_created_at > interval '24 hours' THEN
    RETURN json_build_object('success', false, 'error', 'Chỉ áp dụng cho tài khoản đăng ký trong vòng 24h');
  END IF;

  -- Tìm referrer
  SELECT id, full_name INTO v_referrer_id, v_referrer_name
  FROM public.profiles
  WHERE referral_code = p_referral_code;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Mã giới thiệu không tồn tại');
  END IF;

  -- Không cho phép tự giới thiệu
  IF v_referrer_id = v_referred_id THEN
    RETURN json_build_object('success', false, 'error', 'Bạn không thể tự giới thiệu chính mình');
  END IF;

  -- Transaction bắt đầu (tự động trong block plpgsql)
  UPDATE public.profiles
  SET referred_by_user_id = v_referrer_id
  WHERE id = v_referred_id;

  INSERT INTO public.referrals (referrer_id, referred_id, referral_code_used, status)
  VALUES (v_referrer_id, v_referred_id, p_referral_code, 'pending');

  RETURN json_build_object('success', true, 'referrer_name', v_referrer_name);
END;
$$;

-- ─── 9. RPC: process_referral_rewards ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_referral_rewards(
  p_order_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_referral record;
  v_reward_count integer;
BEGIN
  FOR v_order IN 
    SELECT id, user_id, status, referral_reward_granted
    FROM public.orders 
    WHERE id = ANY(p_order_ids)
  LOOP
    -- 1. Nếu đơn hàng THÀNH CÔNG (approved/paid) và CHƯA kích hoạt thưởng
    IF (v_order.status = 'approved' OR v_order.status = 'paid') AND v_order.referral_reward_granted = false THEN
      
      -- Tìm referral pending của user này
      SELECT * INTO v_referral 
      FROM public.referrals 
      WHERE referred_id = v_order.user_id AND status = 'pending'
      LIMIT 1;

      IF FOUND THEN
        -- Check rate limit 15/tháng của referrer
        SELECT COUNT(*) INTO v_reward_count 
        FROM public.referrals 
        WHERE referrer_id = v_referral.referrer_id 
          AND status = 'rewarded' 
          AND date_trunc('month', rewarded_at) = date_trunc('month', now());

        IF v_reward_count < 15 THEN
          -- Cấp thưởng
          UPDATE public.referrals 
          SET status = 'rewarded', rewarded_at = now(), triggering_order_id = v_order.id
          WHERE id = v_referral.id;

          -- Cộng tiền Referrer (+5000)
          UPDATE public.profiles 
          SET bonus_balance = bonus_balance + v_referral.referrer_reward,
              referral_reward_count = referral_reward_count + 1
          WHERE id = v_referral.referrer_id;

          -- Cộng tiền Referred (+2000)
          UPDATE public.profiles 
          SET bonus_balance = bonus_balance + v_referral.referred_reward
          WHERE id = v_referral.referred_id;

          -- Đánh dấu đơn hàng
          UPDATE public.orders 
          SET referral_reward_granted = true 
          WHERE id = v_order.id;
        END IF;
      END IF;

    -- 2. Nếu đơn hàng BỊ HỦY/HOÀN (rejected/returned) và ĐÃ kích hoạt thưởng
    ELSIF v_order.status = 'rejected' AND v_order.referral_reward_granted = true THEN
      
      -- Tìm referral đã được reward bởi đơn này
      SELECT * INTO v_referral 
      FROM public.referrals 
      WHERE triggering_order_id = v_order.id AND status = 'rewarded'
      LIMIT 1;

      IF FOUND THEN
        -- Clawback
        UPDATE public.referrals 
        SET status = 'clawed_back', clawed_back_at = now(), clawback_order_id = v_order.id
        WHERE id = v_referral.id;

        -- Trừ tiền Referrer (-5000, min 0)
        UPDATE public.profiles 
        SET bonus_balance = GREATEST(0, bonus_balance - v_referral.referrer_reward),
            referral_reward_count = GREATEST(0, referral_reward_count - 1)
        WHERE id = v_referral.referrer_id;

        -- Trừ tiền Referred (-2000, min 0)
        UPDATE public.profiles 
        SET bonus_balance = GREATEST(0, bonus_balance - v_referral.referred_reward)
        WHERE id = v_referral.referred_id;
      END IF;
      
    END IF;
  END LOOP;
END;
$$;
