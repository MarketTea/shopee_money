# Supabase Affiliate Tracking Plan

## Mục tiêu

Nâng cấp landing page chuyển link Shopee từ bản HTML tĩnh sang hệ thống có:

- Google Login để định danh user.
- Database lưu mapping giữa user, link Shopee, `sub_id`, click và đơn hàng.
- Backend gọi ShopeeCD API để tạo affiliate link thay vì tự nối tham số trên browser/server.
- Nền tảng để sau này đối soát đơn Shopee và chia lại hoa hồng cho user.

## Kiến trúc đã chọn

- Frontend: file `index.html`.
- Auth: Supabase Auth với Google Provider.
- Database: Supabase Postgres.
- Backend: Supabase Edge Functions.
- Tracking key: `sub_id` dạng `u_<userShortId>_l_<linkShortId>`.
- Convert & Product Data API: `GET https://data.addlivetag.com/product-data/product-data.php?url={shopeeUrl}&affiliateId={affiliateId}&subId={subId}` (thay thế cho `shopeecd.vercel.app` đã hết hạn cookie từ 05/10/2026).
- Secret Header: `X-API-Key` được lưu an toàn trong Supabase Secrets (`ADDLIVETAG_API_KEY`), không để lộ ở client.

## Những phần đã thêm vào project

- Landing page đã có khu vực đăng nhập Google, trạng thái user, form convert link và lịch sử link.
- Frontend không còn tự tạo `sub_id` bằng timestamp.
- Frontend gọi Edge Function `convert-link` để tạo affiliate link có tracking và lấy thông tin hoa hồng, tên/ảnh sản phẩm qua AddLiveTag API.
- Frontend gọi Edge Function `record-click` khi user mở affiliate link.
- Migration Supabase đã tạo các bảng:
  - `profiles`
  - `affiliate_links`
  - `clicks`
  - `orders`
  - `commission_ledger`
- RLS đã bật để user chỉ đọc được dữ liệu của chính họ.
- Edge Function `convert-link` lưu affiliate link, hoa hồng ước tính (`commission` VNĐ) và tỷ lệ % (`totalRatePercent`) từ AddLiveTag API.
- Edge Function `convert-link` ép `affiliate_url` về đúng `SHOPEE_AFFILIATE_ID` và `sub_id` nội bộ trước khi lưu để tránh attribution sang affiliate khác.
- Edge Function `record-click` đã tạo để lưu click.

## AddLiveTag API response đang dùng

- Endpoint: `GET https://data.addlivetag.com/product-data/product-data.php?url=...&affiliateId=...&subId=...`
- Header: `X-API-Key: <ADDLIVETAG_API_KEY>`
- Mapping trường:
  - `productInfo.affLink` (hoặc build URL `s.shopee.vn/an_redir` chuẩn) -> lưu vào `affiliate_links.affiliate_url`.
  - `productInfo.commission` (format VNĐ, VD: `33.300đ`) -> lưu vào `affiliate_links.estimated_commission`.
  - `productInfo.totalRatePercent` (VD: `22.5`) -> lưu vào `affiliate_links.commission_rate`.
  - `productInfo.productName` -> lưu vào `affiliate_links.product_name`.
  - `productInfo.imageUrl` -> lưu vào `affiliate_links.product_image`.

## Việc cần làm để chạy thật

- [x] Tạo Supabase project mới.
- [x] Vào Supabase Dashboard, bật `Authentication > Providers > Google`.
- [x] Tạo Google OAuth Client trong Google Cloud Console.
- [x] Copy Google Client ID và Client Secret vào Supabase Google Provider.
- [x] Thêm redirect URL local trong Supabase Auth:
  - `http://localhost:8000`
- [ ] Thêm redirect URL production sau khi có domain landing page.
- [x] Cài Supabase CLI nếu máy chưa có.
- [x] Link project:

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

- [x] Push database migration:

```bash
supabase db push
```

- [x] Deploy Edge Functions:

```bash
supabase functions deploy convert-link
supabase functions deploy record-click
```

- [x] Set Shopee affiliate ID:

```bash
supabase secrets set SHOPEE_AFFILIATE_ID=17305840167
```

- [x] Set AddLiveTag API Key trong Supabase Secrets (không để lộ ở frontend):

```bash
supabase secrets set ADDLIVETAG_API_KEY=YOUR_ADDLIVETAG_API_KEY
```

- [x] Mở file `index.html` và thay:

```js
const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

- [x] Test login Google trên local domain đã khai báo redirect.
- [x] Test convert link Shopee sau khi login.
- [x] Kiểm tra bảng `affiliate_links` có record mới với đúng `user_id` và `sub_id`.
- [x] Kiểm tra bảng `affiliate_links` có `estimated_commission` và `commission_rate` từ AddLiveTag API.
- [ ] Bấm mở link Shopee và kiểm tra bảng `clicks` có record mới.

## Việc cần làm tiếp cho giai đoạn đối soát hoa hồng

1. Xác định cách lấy báo cáo đơn hàng Shopee:
   - Upload CSV thủ công từ Shopee Affiliate Portal.
   - Hoặc dùng API nếu tài khoản của bạn có quyền truy cập.
2. Tạo tool/import flow để đọc report Shopee.
3. Với mỗi đơn trong report, lấy `sub_id` và match với bảng `affiliate_links`.
4. Tạo hoặc cập nhật record trong bảng `orders`.
5. Tạo record trong `commission_ledger` khi đơn hợp lệ.
6. Chỉ chuyển hoa hồng từ `pending` sang `approved` khi đơn qua thời gian hoàn/hủy và Shopee xác nhận.
7. Thêm màn hình cho user xem:
   - Link đã tạo
   - Click
   - Đơn hàng
   - Hoa hồng pending/approved/paid
8. Thêm thông tin rút tiền cho user:
   - Số tài khoản ngân hàng
   - Tên chủ tài khoản
   - Ngân hàng
   - Ngưỡng rút tối thiểu

## Test checklist

- Chưa cấu hình Supabase thì landing page hiển thị cảnh báo.
- Chưa login thì không convert link được.
- Login Google thành công thì user được nhận diện.
- Convert link tạo record trong `affiliate_links`.
- Edge Function gọi AddLiveTag API với `url`, `affiliateId`, `subId` và header `X-API-Key`.
- Affiliate URL được lấy từ `productInfo.affLink` (hoặc fallback `s.shopee.vn/an_redir`).
- Giao diện và lịch sử link hiển thị hoa hồng ước tính (`commission` VNĐ) và phần trăm rate (`totalRatePercent`) từ AddLiveTag API.
- `sub_id` có thể truy ngược về `user_id`.
- Lịch sử link chỉ hiển thị link của user hiện tại.
- Click affiliate link tạo record trong `clicks`.
- User không đọc được dữ liệu của user khác nhờ RLS.
- Mock một order theo `sub_id` có thể match đúng user.

## Lưu ý kỹ thuật

- Không đưa email, số điện thoại hoặc thông tin cá nhân thật vào `sub_id`.
- Không để service role key và `ADDLIVETAG_API_KEY` trong frontend client.
- `SUPABASE_ANON_KEY` được phép đặt ở frontend, nhưng `SUPABASE_SERVICE_ROLE_KEY` và `ADDLIVETAG_API_KEY` chỉ dùng trong Edge Function qua `Deno.env.get()`.
- Khi triển khai production, cần dùng HTTPS để Google OAuth và clipboard hoạt động ổn định.
- Nếu dùng CDN Supabase JS trong HTML, cần đảm bảo domain production có thể tải được CDN.
