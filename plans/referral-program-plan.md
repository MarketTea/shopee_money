# Tính Năng Giới Thiệu Bạn Bè (Referral Program)

## Tổng Quan & Quyết Định Đã Xác Nhận

| Tiêu chí | Quyết định |
|----------|-----------|
| Thưởng người giới thiệu | **+5.000đ** khi bạn bè approved đơn đầu tiên |
| Thưởng người được giới thiệu | **+2.000đ** khi tự mình approved đơn đầu tiên (double-sided) |
| Thời điểm cộng thưởng | Ngay khi đơn chuyển sang `approved` |
| Cơ chế hoàn trả | Nếu đơn bị hoàn/hủy → **trừ lại** số tiền thưởng đã cộng |
| Giới hạn | Tối đa **15 người/tháng** có thể kích hoạt thưởng cho 1 referrer |
| Giá trị đơn tối thiểu | Không yêu cầu |
| Áp dụng cho user cũ | **Không** — chỉ user mới đăng nhập lần đầu |
| Hiển thị lịch sử | Cả tên/avatar bạn bè + số liệu thống kê |

> **Tích hợp với hệ thống hiện có**: Dùng lại cột `bonus_balance` trong `profiles` (đã có từ Signup Bonus 20k). Khi rút tiền, mọi loại bonus đều được tính chung vào `totalAvailableForUser` theo công thức đã có sẵn.

---

## Phân Tích Rủi Ro & Biện Pháp Phòng Ngừa

### Kịch bản gian lận & cách xử lý

| # | Kịch bản | Biện pháp |
|---|----------|-----------|
| Tự giới thiệu bản thân | DB constraint `CHECK (referrer_id != referred_id)` |
| Farm multi-account | Giới hạn 15 reward/tháng; log IP để manual review |
| Referral loop (A↔B) | Không ảnh hưởng — mỗi người chỉ được refer 1 lần |
| Đặt đơn rồi hoàn → farm thưởng | **Cơ chế hoàn trả**: đơn bị rejected/returned → trừ bonus |
| User cũ dùng mã ref | Chỉ chấp nhận khi `referred_by_user_id IS NULL` (user mới) |
| Race condition double-credit | DB transaction + `UNIQUE(referred_id)` trên bảng `referrals` |

---

## Thiết Kế Database

### Migration mới: `202607170001_referral_program.sql`

```sql
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
-- referral_code:        mã giới thiệu riêng, auto-generated khi tạo profile
-- referred_by_user_id: ai đã giới thiệu họ — chỉ set 1 lần, không override
-- referral_reward_count: tổng số lần referrer đã được thưởng (mọi thời điểm)

-- ─── 2. Thêm cột vào bảng orders ─────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS referral_reward_granted boolean NOT NULL DEFAULT false;
-- Đánh dấu đơn này đã kích hoạt referral reward chưa (tránh double credit)

-- ─── 3. Tạo bảng referrals ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id          uuid        NOT NULL REFERENCES public.profiles(id),
  referred_id          uuid        NOT NULL REFERENCES public.profiles(id),
  referral_code_used   text        NOT NULL,
  status               text        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'rewarded', 'clawed_back', 'invalid')),
  -- pending:     bạn bè đã đăng ký nhưng chưa có đơn approved
  -- rewarded:    thưởng đã được cộng (đơn approved)
  -- clawed_back: đơn bị hoàn/hủy → đã trừ lại thưởng
  -- invalid:     bị phát hiện gian lận, huỷ thủ công

  referrer_reward      numeric(12,2) NOT NULL DEFAULT 5000,  -- tiền thưởng referrer
  referred_reward      numeric(12,2) NOT NULL DEFAULT 2000,  -- tiền thưởng referred

  rewarded_at          timestamptz,
  clawed_back_at       timestamptz,
  triggering_order_id  uuid REFERENCES public.orders(id),   -- đơn kích hoạt thưởng
  clawback_order_id    uuid REFERENCES public.orders(id),   -- đơn gây ra clawback

  -- Anti-fraud metadata
  referred_ip          text,
  created_at           timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  UNIQUE (referred_id),                                      -- mỗi user chỉ được refer 1 lần
  CONSTRAINT no_self_referral CHECK (referrer_id != referred_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id);
CREATE INDEX IF NOT EXISTS referrals_status_idx   ON public.referrals (status);

-- ─── 4. RLS cho bảng referrals ───────────────────────────────────────────────
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Referrer xem được danh sách người họ đã giới thiệu (để hiển thị UI)
DROP POLICY IF EXISTS "Referrer can read their referrals" ON public.referrals;
CREATE POLICY "Referrer can read their referrals"
  ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_id);

-- ─── 5. Cập nhật trigger handle_new_user — thêm auto-generate referral_code ──
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars  text    := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- loại bỏ I,O,0,1 dễ nhầm
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

    -- Kiểm tra unique
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
    20000,   -- signup bonus 20.000đ
    true,
    public.generate_referral_code()   -- auto-generate referral code
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = excluded.email,
    full_name  = excluded.full_name,
    avatar_url = excluded.avatar_url;
  -- Không cập nhật bonus_balance, signup_bonus_credited, referral_code
  -- để bảo toàn dữ liệu khi user đăng nhập lại

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

---

## Luồng Hoạt Động Chi Tiết

### Luồng 1: User mới đăng ký bằng mã giới thiệu

```
1. User A chia sẻ link: https://yourapp.com?ref=ABC1234
2. User B mở link → JS ghi vào localStorage: { ref: 'ABC1234' }
3. User B bấm "Đăng nhập Google" → Supabase tạo profile
   → trigger handle_new_user() insert profile MỚI với referral_code riêng
4. auth.js sau khi login thành công:
   a. Kiểm tra profiles(B).referred_by_user_id IS NULL (user mới chưa được ref)
   b. Đọc ref từ localStorage
   c. Gọi POST /apply-referral { referral_code: 'ABC1234' }
5. Edge Function apply-referral:
   a. Xác thực JWT → referred_id = B
   b. Lookup profiles WHERE referral_code = 'ABC1234' → referrer_id = A
   c. Validate: A ≠ B (no self-referral)
   d. Validate: profiles(B).referred_by_user_id IS NULL
   e. Trong 1 transaction:
      - INSERT referrals (referrer=A, referred=B, status='pending')
      - UPDATE profiles SET referred_by_user_id=A WHERE id=B
   f. Return { success: true, referrer_name: 'Tên User A' }
6. Frontend xóa localStorage ref, hiển thị toast thành công
```

### Luồng 2: Cộng thưởng khi đơn approved (trong luồng đối soát CSV)

```
Khi import CSV Shopee và đơn chuyển sang status='approved':

1. Lấy user_id của đơn hàng (qua sub_id → affiliate_links → user_id)
2. Kiểm tra: orders(order_id).referral_reward_granted = false
3. Kiểm tra: referrals WHERE referred_id=user_id AND status='pending' EXISTS
4. Kiểm tra rate limit referrer:
   SELECT COUNT(*) FROM referrals
   WHERE referrer_id=referrer_id
     AND status='rewarded'
     AND DATE_TRUNC('month', rewarded_at) = DATE_TRUNC('month', NOW())
   → Nếu >= 15 thì BỎ QUA (không cộng thưởng tháng này)
5. Nếu tất cả OK → trong 1 DB transaction:
   a. UPDATE referrals SET
        status='rewarded',
        rewarded_at=now(),
        triggering_order_id=order_id
      WHERE referred_id=user_id
   b. UPDATE profiles SET
        bonus_balance = bonus_balance + 5000,  -- thưởng người giới thiệu
        referral_reward_count = referral_reward_count + 1
      WHERE id=referrer_id
   c. UPDATE profiles SET
        bonus_balance = bonus_balance + 2000   -- thưởng người được giới thiệu
      WHERE id=user_id  (=referred_id)
   d. UPDATE orders SET referral_reward_granted=true WHERE id=order_id
```

### Luồng 3: Hoàn trả thưởng khi đơn bị hoàn/hủy (Clawback)

```
Khi CSV import cập nhật đơn sang status='rejected' hoặc 'returned':

1. Kiểm tra: orders(order_id).referral_reward_granted = true
2. Tìm referral record có triggering_order_id = order_id
3. Kiểm tra: referrals.status = 'rewarded' (chưa bị clawback)
4. Trong 1 DB transaction:
   a. UPDATE referrals SET
        status='clawed_back',
        clawed_back_at=now(),
        clawback_order_id=order_id
   b. UPDATE profiles SET
        bonus_balance = GREATEST(0, bonus_balance - 5000),
        -- GREATEST(0, ...) để không bị âm nếu user đã rút hết
        referral_reward_count = GREATEST(0, referral_reward_count - 1)
      WHERE id=referrer_id
   c. UPDATE profiles SET
        bonus_balance = GREATEST(0, bonus_balance - 2000)
      WHERE id=referred_id

⚠️ Lưu ý: Nếu bonus_balance < số cần trừ → chỉ trừ về 0, ghi log để manual review.
```

### Luồng 4: Hiển thị referral dashboard

```
1. User vào tab "Giới thiệu"
2. Frontend gọi GET /referral-stats
3. Edge Function trả về:
   - Mã + link của user
   - Danh sách người đã giới thiệu (tên, avatar, trạng thái, thời gian)
   - Tổng tiền đã nhận
   - Số lượng còn lại trong tháng (15 - rewarded_this_month)
```

---

## Thiết Kế Edge Functions

### `POST /apply-referral`

```typescript
// supabase/functions/apply-referral/index.ts

// Input body
interface Input {
  referral_code: string;
}

// Validation logic
// 1. JWT required → referred_user_id
// 2. SELECT * FROM profiles WHERE referral_code = input → referrer
// 3. referrer.id !== referred_user_id
// 4. SELECT referred_by_user_id FROM profiles WHERE id = referred_user_id → must be NULL
// 5. Transaction:
//    INSERT referrals + UPDATE profiles

// Response
{ success: true, referrer_name: string }

// Error codes
// SELF_REFERRAL    → 400
// ALREADY_REFERRED → 400
// CODE_NOT_FOUND   → 404
// USER_NOT_NEW     → 400 (user cũ, đã có referred_by_user_id)
```

### `GET /referral-stats`

```typescript
// supabase/functions/referral-stats/index.ts

// Response
interface ReferralStats {
  referral_code: string;
  referral_link: string;                 // https://domain.com?ref=CODE
  total_referred: number;                // tổng người đã dùng mã (pending + rewarded + clawed_back)
  total_rewarded: number;                // đã nhận thưởng thành công
  total_reward_earned: number;           // tổng VNĐ đã nhận từ referral
  pending_count: number;                 // đăng ký nhưng chưa có đơn
  monthly_limit: number;                 // 15
  monthly_rewarded: number;             // số đã reward trong tháng này
  monthly_remaining: number;            // 15 - monthly_rewarded
  referral_list: Array<{
    full_name: string;                   // tên bạn bè
    avatar_url: string;                  // avatar
    status: 'pending' | 'rewarded' | 'clawed_back';
    joined_at: string;                   // ngày đăng ký
    rewarded_at: string | null;
    reward_earned: number;               // 5000 hoặc 0
  }>;
}
```

---

## Wireframe UI

### Tab "Giới thiệu bạn bè"

```
┌─────────────────────────────────────────────────────────────┐
│  🤝  Giới thiệu bạn bè                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Bạn nhận  +5.000đ ──── Bạn bè nhận +2.000đ                │
│   mỗi khi bạn bè mua hàng thành công lần đầu!               │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Mã của bạn    [ ABC1234 ]  [📋 Sao chép mã]        │    │
│  │  Link chia sẻ  [ https://... ] [📋 Copy] [📤 Share] │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Tháng này: ████████░░░░░░  8/15 lượt còn lại (7 lượt)      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Tổng đã nhận: 35.000đ    ✅ 7 người    ⏳ 3 chờ mua hàng   │
├─────────────────────────────────────────────────────────────┤
│  Danh sách bạn bè đã giới thiệu:                            │
│                                                             │
│  [👤] Nguyễn Văn A  ✅ Đã nhận thưởng   +5.000đ  15/07      │
│  [👤] Trần Thị B    ✅ Đã nhận thưởng   +5.000đ  14/07      │
│  [👤] Lê Văn C      ⏳ Chờ mua hàng     —        12/07      │
│  [👤] Phạm D        ⚠️ Đơn bị hoàn      -5.000đ  10/07      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Badge trong auth panel (chưa đăng nhập)

```
🎁 Có mã giới thiệu? Nhập sau khi đăng nhập để nhận 2.000đ bonus!
```

---

## Kế Hoạch Triển Khai

### Giai Đoạn 1 — Database (làm trước)

- [ ] Tạo file `supabase/migrations/202607170001_referral_program.sql` theo SQL ở trên
- [ ] Run `supabase db push` để apply lên remote
- [ ] Verify: bảng `referrals` tồn tại, cột `referral_code` trong `profiles`
- [ ] Verify: user mới đăng nhập → tự động có `referral_code`

### Giai Đoạn 2 — Edge Functions

- [ ] Tạo `supabase/functions/apply-referral/index.ts`
  - Validate input, check no-self-referral, check user mới
  - Transaction: INSERT referrals + UPDATE profiles
- [ ] Tạo `supabase/functions/referral-stats/index.ts`
  - Query referrals JOIN profiles để lấy tên/avatar
  - Tính monthly_rewarded, monthly_remaining
- [ ] Deploy: `supabase functions deploy apply-referral referral-stats`
- [ ] Test với Postman/curl

### Giai Đoạn 3 — Tích hợp luồng đối soát CSV

- [ ] Cập nhật `assets/js/admin-import.js` (hoặc script tương đương):
  - Thêm logic credit referral khi đơn → approved
  - Thêm logic clawback khi đơn → rejected/returned
  - Áp dụng rate limit 15/tháng trước khi credit

### Giai Đoạn 4 — Frontend

- [ ] `assets/js/auth.js`: sau login, đọc localStorage `ref` → gọi `apply-referral`
- [ ] `index.html`: thêm tab "Giới thiệu" vào navigation
- [ ] `assets/js/referral.js` (mới): load và render referral dashboard
- [ ] `assets/css/referral.css` (mới): style tab giới thiệu
- [ ] Hiển thị monthly progress bar (X/15 lượt tháng này)
- [ ] Hiển thị danh sách bạn bè với trạng thái realtime

---

## Rủi Ro Kỹ Thuật

| Rủi Ro | Xác suất | Mức độ | Mitigation |
|--------|----------|--------|------------|
| Double credit do race condition | Thấp | Cao | DB transaction + UNIQUE(referred_id) |
| Clawback khi user đã rút tiền | Trung bình | Trung bình | `GREATEST(0, balance - amount)` + ghi log nợ |
| referral_code generate trùng | Rất thấp | Thấp | Retry loop + UNIQUE constraint |
| Bot farm 15 tài khoản/tháng | Trung bình | Trung bình | Log IP, manual review khi thấy bất thường |
| User hoàn đơn nhiều lần | Có thể | Cao | Chỉ clawback 1 lần theo `clawback_order_id` |

---

## Lưu Ý Quan Trọng

1. **Clawback không được trừ âm**: Dùng `GREATEST(0, bonus_balance - amount)`. Nếu user đã rút hết tiền rồi mới bị clawback → số dư về 0, ghi log để admin biết.

2. **Rate limit 15/tháng**: Tính theo calendar month, không phải rolling 30 ngày. Reset về 0 đầu mỗi tháng. Khi đủ 15, referral record vẫn được INSERT (status=pending) nhưng không cộng tiền — user vẫn thấy bạn bè trong danh sách, chỉ là không nhận thưởng.

3. **User cũ**: Nếu `referred_by_user_id IS NOT NULL` → bỏ qua, không apply ref code, không báo lỗi to — chỉ silently skip.

4. **Hiển thị đơn bị clawback**: Trong danh sách bạn bè, hiện icon ⚠️ và ghi chú "Đơn bị hoàn" để user hiểu tại sao tiền bị trừ.

5. **Mã referral không đổi**: `referral_code` được generate 1 lần và không thay đổi trong suốt vòng đời tài khoản. Nếu user muốn "reset mã" để tránh bị share lung tung, cần làm feature riêng sau.
