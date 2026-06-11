# landing-sp-ref

Landing page chuyển link Shopee Affiliate, đã thêm bản v1 tracking user bằng Supabase.

## Supabase setup

1. Tạo Supabase project mới.
2. Trong Supabase Dashboard, bật `Authentication > Providers > Google`.
3. Thêm redirect URL cho domain chạy landing page, ví dụ:
   - `http://localhost:8000`
   - domain production của bạn
4. Chạy migration:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

5. Deploy Edge Function:

```bash
supabase functions deploy convert-link
supabase functions deploy record-click
```

6. Set secret cho Edge Function:

```bash
supabase secrets set SHOPEE_AFFILIATE_ID=17305840167
```

7. Mở `index.html` và thay:

```js
const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

## Luồng tracking

- User đăng nhập Google qua Supabase Auth.
- Frontend gọi Supabase Edge Function `convert-link`.
- Function tạo `sub_id` dạng `u_<userShortId>_l_<linkShortId>`.
- Function gọi ShopeeCD API `https://shopeecd.vercel.app/api/public/shopee/convert-link` với `originalLink`, `affiliateId`, `subId1`.
- Function lưu mapping, affiliate URL, hoa hồng ước tính và rate vào bảng `affiliate_links`.
- Frontend hiển thị affiliate URL sau khi convert và hiển thị hoa hồng ước tính trong lịch sử link của user.
- Khi user mở link Shopee, frontend gọi `record-click` để lưu lượt click vào bảng `clicks`.

ShopeeCD API response được dùng từ `results[0]`:

- `shortLink` hoặc `longLink` -> `affiliate_links.affiliate_url`
- `commission` -> `affiliate_links.estimated_commission`
- `rate` -> `affiliate_links.commission_rate`
- `commission_name` -> `affiliate_links.product_name`
- `product_image` -> `affiliate_links.product_image`

## Database

Migration `supabase/migrations/202606020001_affiliate_tracking_v1.sql` tạo:

- `profiles`
- `affiliate_links`
- `clicks`
- `orders`
- `commission_ledger`

Migration `supabase/migrations/202606080001_payout_qr_profiles.sql` thêm:

- thông tin QR nhận hoàn tiền trong `profiles`
- private Storage bucket `payout-qr`
- Storage RLS để user chỉ thao tác file QR của chính mình

Migration `supabase/migrations/202606120001_affiliate_link_estimated_commission.sql` thêm vào `affiliate_links`:

- `estimated_commission`
- `commission_rate`
- `product_name`
- `product_image`

Các bảng đã bật RLS. User chỉ đọc được dữ liệu của chính họ; việc insert link được thực hiện qua Edge Function.
