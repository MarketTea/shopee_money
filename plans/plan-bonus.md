# Bonus Đăng Ký 20.000đ & Validate Rút Tiền Tối Thiểu 50.000đ

## Summary

Tính năng này khuyến khích user đăng nhập và dùng app nhiều hơn bằng hai cơ chế:

1. **Signup Bonus**: Mỗi user đăng nhập Google lần đầu được tự động cộng **20.000đ** vào tài khoản.
2. **Ngưỡng rút tiền tối thiểu**: Chỉ cho phép rút tiền khi tổng số dư **từ 50.000đ trở lên**.

> **Lưu ý quan trọng về công thức tính ngưỡng 50.000đ:**
> - `commission` trong hệ thống là tổng hoa hồng (net_commission) mà platform thu được — đây chưa phải số tiền của user.
> - Số tiền user thực nhận = `net_commission / 2` (50% hoa hồng)
> - Tổng số dư dùng để kiểm tra ngưỡng = **(net_commission / 2) + bonus_balance**
> - Ví dụ: net_commission = 60.000đ, bonus = 20.000đ → số dư = 30.000 + 20.000 = **50.000đ** ✅ đủ điều kiện rút

Bonus được lưu trực tiếp trong bảng `profiles` (cột `bonus_balance`). Tổng số dư hiển thị và dùng để rút = (net_commission của các đơn đủ điều kiện / 2) + bonus_balance.

Migration đã được push lên remote database thành công vào ngày 2026-07-05.

---

## Key Changes

### Database — `supabase/migrations/202607050001_signup_bonus.sql`

- Thêm 2 cột mới vào bảng `public.profiles`:
  - `bonus_balance numeric(12, 2) not null default 0` — số dư bonus của user
  - `signup_bonus_credited boolean not null default false` — đánh dấu đã tặng bonus chưa

- Cập nhật hàm trigger `handle_new_user()`:
  - User **mới** tạo tài khoản được insert với `bonus_balance = 20000` và `signup_bonus_credited = true`
  - `ON CONFLICT (id) DO UPDATE` chỉ cập nhật `email`, `full_name`, `avatar_url` — **không** ghi đè `bonus_balance` và `signup_bonus_credited` để tránh reset bonus khi user đăng nhập lại

- Không cần thêm RLS policy vì policy `"Users can read their own profile"` đã cover cột mới.

### Frontend — `assets/js/auth.js`

- Hàm `setCurrentUser()` được cập nhật: sau khi set user, gọi `grantSignupBonusIfNeeded()` trước khi load data.

- Hàm `grantSignupBonusIfNeeded()` (async):
  - Fetch `signup_bonus_credited` và `bonus_balance` từ bảng `profiles`
  - Nếu `signup_bonus_credited = false` hoặc `null` (user cũ chưa nhận bonus): upsert `bonus_balance = 20000` và `signup_bonus_credited = true`
  - Nếu đã credited: bỏ qua hoàn toàn
  - **Idempotent**: chạy nhiều lần không tặng thêm bonus

### Frontend — `assets/js/withdrawal.js`

- Thêm biến module `_withdrawBonusBalance` và hằng `WITHDRAW_MINIMUM_AMOUNT = 50000`.

- Hàm `loadWithdrawData()`:
  - Fetch thêm `bonus_balance` từ bảng `profiles` ở bước đầu
  - Tính `totalAvailableForUser = commissionForUser + _withdrawBonusBalance`
  - Truyền thêm `bonusBalance`, `hasBonus`, `totalAvailable`, `meetsMinimum` vào `setWithdrawSummary()`

- Hàm `setWithdrawSummary()`:
  - Hiển thị/ẩn dòng bonus (`#withdrawBonusRow`) tùy `hasBonus`
  - Hiển thị/ẩn cảnh báo ngưỡng tối thiểu (`#withdrawMinWarning`) tùy `meetsMinimum`
  - Disable nút rút tiền nếu `meetsMinimum = false`

- Hàm `submitWithdrawRequest()`:
  - Validate `totalAvailableForUser >= 50000` trước khi gửi request
  - `amount` ghi vào DB = commission + bonus (tổng thực tế user được nhận)

### HTML — `index.html`

- **Auth panel** (khi chưa đăng nhập): thêm badge `🎁 Đăng nhập lần đầu nhận ngay **20.000đ** vào tài khoản!` (`div.auth-bonus-badge`)

- **Withdraw modal** — phần summary:
  - Thêm dòng `🎁 Bonus tặng khi đăng ký` (`#withdrawBonusRow` / `#withdrawBonusAmount`), mặc định `display:none`, chỉ hiện khi có bonus
  - Thêm dòng cảnh báo `#withdrawMinWarning` bên dưới summary box, mặc định `display:none`

### CSS

**`assets/css/hero-converter.css`**:
- `.auth-bonus-badge`: badge vàng amber, `border-radius: 20px`, animation `bonusPulse` tạo hiệu ứng glow nhẹ mỗi 2.5s

**`assets/css/payout.css`**:
- `.withdraw-summary-row.withdraw-bonus-row`: row nền vàng nhạt với viền amber để phân biệt với các row khác
- `.withdraw-bonus`: text màu amber đậm, font-weight 700
- `.withdraw-min-warning`: box cảnh báo nền cam nhạt với viền cam, dùng để thông báo ngưỡng tối thiểu chưa đạt

---

## Logic Tính Số Dư

```
─── Dữ liệu gốc từ DB ───
net_commission        = tổng hoa hồng của các đơn "approved" chưa rút
                        (là số tiền platform thu, chưa phải của user)
bonus_balance         = lấy từ profiles.bonus_balance

─── Tính số tiền thực nhận của user ───
commissionForUser     = net_commission / 2     ← 50% hoa hồng user được nhận
totalAvailableForUser = commissionForUser + bonus_balance

─── Kiểm tra điều kiện rút ───
Cần: totalAvailableForUser >= 50.000đ
≈  (net_commission / 2) + bonus_balance >= 50.000đ

Ví dụ minh họa:
  net_commission = 0đ,    bonus = 20.000đ  → 0 + 20.000 = 20.000đ  ❌ chưa đủ
  net_commission = 40.000đ, bonus = 20.000đ  → 20.000 + 20.000 = 40.000đ  ❌ chưa đủ
  net_commission = 60.000đ, bonus = 20.000đ  → 30.000 + 20.000 = 50.000đ  ✅ đủ điều kiện
  net_commission = 100.000đ, bonus = 0đ      → 50.000 + 0 = 50.000đ  ✅ đủ điều kiện

─── Số tiền ghi vào withdrawal_requests.amount ───
amount = totalAvailableForUser  (commissionForUser + bonus_balance)
```

---

## Luồng Hoạt Động

### User mới (chưa từng đăng nhập)

```
1. User bấm "Đăng nhập Google"
2. Supabase OAuth redirect → user được tạo trong auth.users
3. Trigger on_auth_user_created → insert profile với bonus_balance=20000, signup_bonus_credited=true
4. Client nhận session → setCurrentUser() → grantSignupBonusIfNeeded()
5. grantSignupBonusIfNeeded() đọc DB → signup_bonus_credited=true → bỏ qua (trigger đã credit)
6. loadPayoutProfile() / loadWithdrawData() → hiển thị bonus_balance=20.000đ
```

### User cũ (đã có tài khoản, chưa có bonus)

```
1. User đăng nhập → setCurrentUser() → grantSignupBonusIfNeeded()
2. Đọc DB → signup_bonus_credited=false (cột mới, default false)
3. Upsert: bonus_balance=20000, signup_bonus_credited=true
4. loadPayoutProfile() / loadWithdrawData() → hiển thị bonus_balance=20.000đ
```

### User cố rút tiền khi chưa đủ 50k

```
1. Mở withdraw modal → loadWithdrawData()
2. totalAvailable = 20.000đ (chỉ có bonus, chưa có đơn hàng)
3. meetsMinimum = false → nút bị disable, hiện cảnh báo:
   "Cần ít nhất 50.000đ để rút tiền. Hiện tại bạn có 20.000đ."
4. Nếu cố gọi submitWithdrawRequest() bằng cách khác:
   → validate thêm một lần nữa, trả về lỗi tương tự
```

---

## Files Thay Đổi

| File | Loại thay đổi |
|------|--------------|
| `supabase/migrations/202607050001_signup_bonus.sql` | Tạo mới — migration DB |
| `assets/js/auth.js` | Cập nhật — thêm `grantSignupBonusIfNeeded()` |
| `assets/js/withdrawal.js` | Cập nhật — tích hợp bonus, validate 50k |
| `index.html` | Cập nhật — UI badge bonus, dòng bonus & warning trong modal |
| `assets/css/hero-converter.css` | Cập nhật — CSS badge `.auth-bonus-badge` |
| `assets/css/payout.css` | Cập nhật — CSS bonus row & warning |

---

## Ghi Chú

- **Migration đã được deploy**: `supabase db push` thành công ngày 2026-07-05, migration `202607050001_signup_bonus.sql` đã áp dụng lên remote database.
- **Không ảnh hưởng user đang rút**: bonus chỉ cộng vào số dư hiển thị; các lần rút cũ dùng `amount` từ commission không bị tính lại.
- **An toàn khi reload**: `signup_bonus_credited` đảm bảo bonus chỉ được tặng đúng một lần dù user đăng nhập bao nhiêu lần.
- Để thay đổi số tiền bonus hoặc ngưỡng tối thiểu, sửa các giá trị trong:
  - Trigger SQL: `bonus_balance = 20000`
  - `assets/js/withdrawal.js`: `WITHDRAW_MINIMUM_AMOUNT = 50000`
  - `assets/js/auth.js`: `bonus_balance: 20000` trong upsert của `grantSignupBonusIfNeeded()`
