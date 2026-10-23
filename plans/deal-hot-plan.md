# 🔥 Deal Hot (Shopee Deal Hunter) — Tài liệu kỹ thuật

> Tài liệu này là **nguồn tham chiếu duy nhất** cho tính năng Deal Hot: luồng dữ liệu, hợp đồng tracking,
> phân quyền, cách test và các điểm cần lưu ý khi bảo trì.
>
> Cập nhật lần cuối: đợt v6 (`202610230001` — action links: đủ định dạng link Shopee), sau đợt hardening
> `202610190001` + `202610200001`, đợt sửa UI product grid và đợt tinh gọn nav.

---

## 0. Đọc nhanh 5 phút — 3 bất biến không được phá

Nếu 1 trong 3 điều này sai, tính năng sẽ "chạy được" nhưng **mất tiền hoặc mất dữ liệu**:

| # | Bất biến | Nơi thực thi | Cách kiểm tra |
| :-- | :--- | :--- | :--- |
| **A** | `sub_id` trong link Shopee **phải bằng** `affiliate_links.sub_id` | RPC tự dựng URL từ chính `sub_id` nó lưu + CHECK constraint `affiliate_links_sub_id_in_url` | `select count(*) from affiliate_links where affiliate_url not like '%sub_id='\|\|sub_id\|\|'%';` → phải `0` |
| **B** | Chỉ admin thật được ghi `deal_campaigns` / `deal_products` | RLS + bảng `deal_admins` + hàm `is_deal_admin()` | Đăng nhập account khác → mở `admin.html` phải bị chặn |
| **C** | Mọi `sub_id` xuất hiện trong CSV Shopee **phải có row** trong `affiliate_links` | RPC tạo row cho user; seed `deal_guest` cho khách | `select * from affiliate_links where sub_id = 'deal_guest';` → phải có |

Lý do của **A**: `scripts/import-shopee-conversions.mjs` đối soát **chỉ theo `Sub_id1` → `affiliate_links.sub_id`**;
row nào không khớp thì bị **bỏ qua** (không tạo `orders`, không có hoàn tiền).

---

## 1. Tổng quan

- **Ai dùng:** KOL/admin paste tin nhắn thô từ group Shopee → hệ thống parse → publish → user cuối săn deal.
- **Kiếm tiền:** toàn bộ link sản phẩm gắn Affiliate ID của admin (`17305840167`). Khi user bấm "Mua ngay",
  server sinh `sub_id` định danh user → CSV Shopee trả về → import → cộng hoa hồng vào ví user ("Mô hình A").
- **Khách chưa đăng nhập:** mua bằng `sub_id = deal_guest` → hoa hồng 100% về admin.

---

## 2. Luồng end-to-end

### 2.1 Luồng publish (admin)

```text
[Group Shopee] --copy text--> [admin.html]
                                   │
                                   │ 1. parseDealContent(text)   (deal-parser.js, hàm thuần)
                                   ▼
                         [Preview + sửa ngày]
                                   │
                                   │ 2. validateParsedCampaigns()
                                   │ 3. insert deal_campaigns (kèm raw_content)
                                   │ 4. insert deal_products (1 lần, all-or-nothing)
                                   ▼
                    success ──► xoá textarea + ẩn preview
                    lỗi sản phẩm ──► DELETE campaign (rollback) ──► preview chỉ còn campaign lỗi
```

Các điểm logic quan trọng (`assets/js/admin-deals.js`):

| Bước | Hàm | Ghi chú |
| :--- | :--- | :--- |
| Parse | `previewParsedContent()` → `parseDealContent()` | Không publish nếu textarea rỗng |
| Vẽ preview | `renderParsePreview()` | Tách riêng để vẽ lại từ `parsedCampaigns` mà **không parse lại** |
| Sửa ngày | listener `change` trên `#parsePreview` | Cho phép admin sửa `start_date`/`end_date` trước khi publish |
| Validate | `validateParsedCampaigns()` | Title ≥ 3 ký tự, ngày ISO hợp lệ, `end >= start` |
| Chống trùng | `publishedCampaignKeys` (Set trong phiên) | Khoá = `title\|start_date\|end_date`; bấm Preview lại rồi Publish **không tạo bản trùng**; đổi ngày thì được publish lại |
| Rollback | trong `catch` | `delete deal_campaigns` nếu insert sản phẩm lỗi → không để campaign rỗng |
| Retry | cuối `publishAllCampaigns()` | `parsedCampaigns = failedCampaigns` → publish lại chỉ đụng campaign lỗi |

### 2.2 Luồng user mua (deals.html)

```text
[deals.html] loadDeals()
   │  select cột tường minh + deal_products (+ action_links)
   │  sort: còn hạn trước, hết hạn sau        │  countdown: 1 ticker duy nhất
   ▼
[Click "Mua ngay" / "Xem toàn bộ gian hàng" / CTA sự kiện]
   │
   ├─ deal hết hạn? ──► toast + không làm gì (nút đã disabled)
   │
   ├─ CTA sự kiện / voucher / bộ sưu tập, nút gian hàng ──►
   │        openEventLinkWithAffiliate(url)  (bọc an_redir + sub_id tại thời điểm click)
   │
   ├─ chưa đăng nhập ──► modal 2 lựa chọn
   │        ├─ "Đăng nhập nhận hoàn tiền" ──► lưu {id,ts} vào localStorage ──► OAuth
   │        └─ "Tiếp tục mua (không hoàn tiền)" ──► mở link với sub_id = deal_guest
   │
   └─ đã đăng nhập ──► buyProductWithCashback()
             │ 1. window.open('about:blank')   (mở tab trước để không bị popup blocker)
             │ 2. rpc('generate_deal_affiliate_link', { p_product_id })   ← CHỈ gửi product id
             │ 3. kiểm tra URL trả về khớp /^https:\/\/s\.shopee\.vn\/an_redir\?/
             │ 4. mở URL đó
             └─ lỗi RPC ──► mở link fallback (client tự build) + cảnh báo "có thể KHÔNG được hoàn tiền"
```

Sau khi OAuth quay lại: `initDeals()` **chờ** `waitForAuth()` (tối đa 4s) rồi mới `loadDeals()` →
`checkPendingDealPurchase()` đọc localStorage (TTL 30 phút, chỉ nhận UUID) → **scroll + highlight + toast**,
**không tự mở Shopee** (tránh popup blocker và hành vi bất ngờ).

---

## 3. Data model

### 3.1 `deal_campaigns`

| Cột | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `id` | uuid PK | `gen_random_uuid()` |
| `title` | text not null | ≤ 200 ký tự (parser cắt) |
| `brand` | text | `null` nếu parser không chắc (không đoán mò) |
| `category` | text | CHECK: `Beauty, Fashion, Tech, Food, Voucher, Khác` |
| `start_date` / `end_date` | date | CHECK: `end_date >= start_date` (constraint `NOT VALID` — chỉ áp row mới) |
| `highlights` | text[] | tối đa 6 |
| `voucher_codes` | jsonb | `[{ "code": "...", "desc": "..." }]` |
| `store_url` | text | link gian hàng (không phải `/a-i.`, `/product/`, `/user/`, `/m/`…) |
| `action_links` | jsonb | CTA sự kiện/voucher/bộ sưu tập `[{label,url,cta_label}]` (migration `202610230001`) |
| `raw_content` | text | **nội dung gốc** — client KHÔNG đọc được (xem §4.3) |
| `is_active` | bool | public chỉ đọc row `true` |
| `sort_order` | int | |
| `created_at` / `updated_at` | timestamptz | `updated_at` do trigger `on_deal_campaign_updated` |

### 3.2 `deal_products`

| Cột | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `id` | uuid PK | |
| `campaign_id` | uuid FK → `deal_campaigns` ON DELETE CASCADE | |
| `name` | text not null | từ parser (đã bỏ URL/heading) |
| `affiliate_url` | text not null | link `shopee.vn/a-i.*` |
| `discount_label`, `gift_description` | text | |
| `has_gift` | bool | |
| `click_count` | int | tăng mỗi lần RPC được gọi (hiện chưa hiển thị ở UI) |
| `sort_order` | int | |

### 3.3 Index

| Index | Mục đích |
| :--- | :--- |
| `deal_campaigns_public_sort_idx (is_active, end_date, created_at desc)` | đúng thứ tự sort của trang public |
| `deal_campaigns_category_idx (category)` | filter tab |
| `deal_products_campaign_idx (campaign_id, sort_order)` | load sản phẩm theo campaign |

### 3.4 RLS (tóm tắt)

| Bảng | `anon` | `authenticated` | Admin (`deal_admins`) | `service_role` |
| :--- | :--- | :--- | :--- | :--- |
| `deal_campaigns` | SELECT row `is_active = true` (trừ `raw_content`) | như anon | full CRUD | bypass |
| `deal_products` | SELECT thuộc campaign active | như anon | full CRUD | bypass |
| `deal_admins` | ✖ | ✖ | ✖ (chỉ đọc qua hàm SECURITY DEFINER) | bypass |
| `affiliate_links` | ✖ | SELECT row của mình | — | bypass |
| `clicks` | ✖ | SELECT row của mình | — | bypass |

> **Không còn policy INSERT nào cho client** trên `affiliate_links`/`clicks` — chỉ RPC SECURITY DEFINER
> (và edge function `convert-link` dùng service_role) được ghi.

### 3.5 Định dạng link được parser nhận

| Dạng link | Ví dụ | Kết quả |
| :--- | :--- | :--- |
| Sản phẩm affiliate | `shopee.vn/a-i.<shopId>.<itemId>` | `deal_products.affiliate_url` |
| Sản phẩm (slug bất kỳ) | `shopee.vn/abc-i.<shopId>.<itemId>` | `deal_products.affiliate_url` |
| Sản phẩm chuẩn | `shopee.vn/product/<shopId>/<itemId>` | `deal_products.affiliate_url` |
| Gian hàng | `shopee.vn/<shop_username>` (`.`/`_` OK) | `deal_campaigns.store_url` → nút "Xem toàn bộ gian hàng" |
| Landing / sale / ví voucher | `shopee.vn/m/...`, `/user/voucher-wallet/`, `/voucher...` | `action_links` (CTA) |
| Trang có query / bộ sưu tập | `shopee.vn/<shop>?shopCollection=<id>` | `action_links` (CTA "Xem Bộ Sưu Tập") |

- Parser bóc **cả** sản phẩm **và** `action_links` trong cùng campaign (bài post thường trộn nhiều dạng).
- Mọi link Shopee đều được bọc `s.shopee.vn/an_redir` trước khi mở: sản phẩm qua RPC (server sinh `sub_id`),
  CTA/gian hàng qua `openEventLinkWithAffiliate()` (client sinh `sub_id` tại thời điểm click).
- Link không rơi vào các nhóm trên sẽ bị bỏ. Test `mọi link Shopee trong fixture đều được convert`
  sẽ fail nếu `plans/deal_hot.txt` có dạng mới chưa được xử lý → thêm regex + test khi gặp dạng mới.

---

## 4. Hợp đồng tracking (phần quan trọng nhất)

### 4.1 Định dạng `sub_id`

```text
u_<8 ký tự đầu uuid user, bỏ dấu gạch>_l_<8 ký tự đầu uuid link, bỏ dấu gạch>
   ví dụ: u_4a4e57a6_l_9f3c21bd
```

- Sinh **hoàn toàn ở server** (RPC). Client không gửi `sub_id`/URL nữa.
- `affiliate_links.sub_id` là `UNIQUE`.
- Đơn của khách vãng lai: `sub_id = 'deal_guest'` (1 row duy nhất, thuộc admin).

### 4.2 RPC `generate_deal_affiliate_link`

```sql
generate_deal_affiliate_link(p_product_id uuid, p_link_id uuid default null) returns jsonb
```

| Bước | Logic |
| :--- | :--- |
| 1 | `auth.uid()` null → lỗi `42501` ("Vui lòng đăng nhập") |
| 2 | Product phải thuộc campaign `is_active` **và** `end_date is null or end_date >= current_date` |
| 3 | `affiliate_url` phải khớp `^https://…(shopee.vn\|shope.ee\|shp.ee)/` |
| 4 | **Tái sử dụng** link trong 30 phút: cùng user + cùng `original_url` + row đó còn thoả bất biến A → trả lại link cũ (tránh spam row, `sub_id` ổn định) |
| 5 | Nếu chưa có: sinh `link_id`, `sub_id`, dựng URL `https://s.shopee.vn/an_redir?origin_link=<encoded>&affiliate_id=17305840167&sub_id=<sub_id>` (encode qua `deal_url_encode()` — encode `%` trước) |
| 6 | Insert `affiliate_links` (id, user_id, original_url, normalized_url, sub_id, affiliate_url, product_name) |
| 7 | `UPDATE deal_products SET click_count = click_count + 1` |
| 8 | Insert `clicks` **nếu** chưa có click nào cho link này trong 60 giây |

Trả về:

```json
{ "id": "uuid", "sub_id": "u_..._l_...", "affiliate_url": "https://s.shopee.vn/an_redir?...",
  "product_name": "...", "click_count": 12, "reused": true }
```

Quyền: `revoke ... from public, anon` + `grant execute ... to authenticated, service_role`.

### 4.3 `raw_content` không public

`202610200001` thu hồi `SELECT` mức bảng và chỉ grant mức **cột** (trừ `raw_content`) cho `anon`/`authenticated`.
Vì vậy:

- Client **phải** select cột tường minh (đang làm trong `deals.js` và `admin-deals.js`).
- **Không bao giờ** dùng `.select('*')` trên `deal_campaigns` (PostgREST sẽ trả 403).
- `raw_content` vẫn INSERT/UPDATE được bởi admin; đọc qua SQL Editor / `service_role`.
- **Thêm cột mới** vào `deal_campaigns` → phải chạy:
  ```sql
  grant select (ten_cot) on public.deal_campaigns to anon, authenticated;
  ```

### 4.4 Đối soát CSV

`scripts/import-shopee-conversions.mjs`:

```text
CSV Shopee (Sub_id1) ──match──► affiliate_links.sub_id ──► user_id
                                        │
                                        ▼
                          orders (unique shopee_order_id)
                                        │
                                        ▼
                          commission_ledger (unique order_id) ──► ví user
```

- Row CSV **không khớp** `sub_id` → bị bỏ qua hoàn toàn (`matched_row_count` / `unmatched_row_count` được ghi lại trong `shopee_conversion_imports`).
- Đơn của `deal_guest` → `orders.user_id = admin` → tiền vào ví admin.

---

## 5. Business rules

| Rule | Giá trị | Nơi thực thi |
| :--- | :--- | :--- |
| Deal hết hạn (UI) | `end_date` tính đến 23:59:59 **giờ local của browser** | `deals.js: isCampaignExpired()` — disable nút "Mua ngay" |
| Deal hết hạn (server) | `end_date >= current_date` (**timezone DB**, Supabase = UTC) | RPC bước 2 |
| Campaign ẩn | `is_active = false` → public không thấy, RPC từ chối | RLS + RPC |
| Tái sử dụng link | 30 phút / cùng user + cùng product URL | RPC bước 4 |
| Dedupe click | 60 giây / link | RPC bước 8 |
| Chống publish trùng | Set khoá `title\|start\|end` trong 1 phiên admin | `admin-deals.js: publishedCampaignKeys` |
| Retry sau lỗi | Chỉ còn campaign lỗi trong preview | cuối `publishAllCampaigns()` |
| Chờ auth trước khi render | tối đa 4s | `auth.js: waitForAuth()` + `deals.js: initDeals()` |

> **Lệch timezone có chủ ý:** client chặn theo giờ VN, RPC chặn theo `current_date` UTC (UTC chậm hơn VN 7h)
> → RPC **dễ dãi hơn** client. Không gây lỗi cho user; chỉ ngăn user tự gọi RPC sau khi deal hết hạn vài giờ.

---

## 6. File map

| File | Vai trò | Ghi chú |
| :--- | :--- | :--- |
| `supabase/migrations/202610170001_deal_campaigns.sql` | schema + trigger + RLS public read | đã push |
| `supabase/migrations/202610180001_deal_affiliate_links.sql` | `click_count`, RPC bản đầu | đã push (RPC đã bị thay) |
| `supabase/migrations/202610190001_deal_hardening.sql` | `deal_admins`, RLS admin, RPC mới, constraints, index, seed `deal_guest` | **bắt buộc chạy** |
| `supabase/migrations/202610200001_deal_raw_content_private.sql` | ẩn `raw_content` | **bắt buộc chạy** |
| `supabase/migrations/202610230001_deal_action_links.sql` | cột `action_links` + grant select mức cột | **bắt buộc chạy trước khi publish** |
| `assets/js/deal-parser.js` | regex engine (hàm thuần, không DOM) | có test |
| `assets/js/deals.js` | data + render + modal + countdown + buy flow | |
| `assets/js/admin-deals.js` | preview, publish, rollback, CRUD, `adminConfirm()` | có test |
| `assets/js/auth.js` | `initAuth`, `waitForAuth`, header user menu | dùng chung 4 trang |
| `assets/css/deals.css` | UI trang public (grid sản phẩm, countdown, voucher) | |
| `assets/css/admin-deals.css` | UI admin (topbar, preview, dialog) | |
| `deals.html` | trang public | load: `config → utils → auth → deals` |
| `admin.html` | trang admin (noindex) | load: `config → utils → deal-parser → admin-deals` |
| `plans/deal_hot.txt` | fixture thật dùng cho test parser | **đừng sửa** khi chưa cập nhật test |
| `assets/js/deal-parser.test.js` | 12 test parser (gồm cả post chỉ có voucher) | `node --test` |
| `assets/js/admin-deals.test.js` | 3 test logic publish (rollback / dedupe / retry) | `node --test` |

---

## 7. Phân quyền admin

Quyền ghi nằm ở bảng `deal_admins` — **không** dựa vào `ADMIN_EMAILS` trong JS (chỉ là lớp UI).

```sql
-- thêm admin
insert into public.deal_admins (user_id)
select id from auth.users where lower(email) = 'email@gmail.com'
on conflict (user_id) do nothing;

-- kiểm tra
select a.user_id, u.email from public.deal_admins a join auth.users u on u.id = a.user_id;
```

> Không dùng cột `profiles.is_admin` (policy UPDATE hiện tại cho phép user sửa mọi cột của chính họ).

---

## 8. Test & verify

### 8.1 Unit test (không cần mạng)

```bash
node --test assets/js/*.test.js        # 19 test: 16 parser + 3 publish logic
```

Parser test khoá lại các bug đã từng xảy ra: ngày `2026-16-15`, brand rác (`NGÀ`, `50%`),
tên sản phẩm là URL, voucher trùng/mã rác, giá `1.5 triệu` bị đọc thành ngày,
và test "mọi link Shopee trong fixture đều được convert" (thêm dạng link mới mà quên
xử lý là test fail ngay).

Publish test khoá lại: rollback khi products lỗi, không tạo bản trùng khi Preview lại,
đổi ngày thì được publish lại.

### 8.2 SQL kiểm tra sau khi deploy

```sql
-- A. Hàm mới (phải là p_product_id, p_link_id)
select pg_get_function_identity_arguments(oid) from pg_proc
where proname = 'generate_deal_affiliate_link';

-- B. Admin đã seed
select a.user_id, u.email from public.deal_admins a join auth.users u on u.id = a.user_id;

-- C. raw_content đã ẩn, action_links đọc được
select has_column_privilege('anon', 'public.deal_campaigns', 'raw_content', 'select');       -- false
select has_column_privilege('anon', 'public.deal_campaigns', 'action_links', 'select');      -- true
select has_column_privilege('anon', 'public.deal_campaigns', 'title', 'select');             -- true

-- D. Link guest
select sub_id, product_name from public.affiliate_links where sub_id = 'deal_guest';

-- E. Bất biến A (phải = 0)
select count(*) from public.affiliate_links
where affiliate_url not like '%sub_id=' || sub_id || '%';
```

### 8.3 E2E checklist

1. `admin.html` → login email admin → thấy "Campaigns Hiện Tại" (không thấy = chưa có trong `deal_admins`).
2. Paste `plans/deal_hot.txt` → **Preview Parse** → đúng **11 campaign**, 29 sản phẩm, 9 CTA sự kiện;
   ngày `17/10–20/10`, `15–16/10`, `15–20/10`; brand `UNILEVER / Innisfree / HALIO / LANCOME / Colgate`;
   Colgate phải có **3 sản phẩm** (2 link `/product/...`) + **2 CTA bộ sưu tập**.
3. **Publish All** → toast thành công; xoá 1 campaign → phải hiện **dialog xác nhận** (không phải `confirm()`).
4. `deals.html`: 11 campaign, không lỗi console; campaign chỉ có link sự kiện hiện nút CTA vàng;
   nút "Xem toàn bộ gian hàng" mở qua `s.shopee.vn/an_redir`; deal hết hạn nút xám "Đã kết thúc".
5. Khách (incognito) → "Mua ngay" → modal → "Tiếp tục mua" → link có `sub_id=deal_guest`.
6. Đã login → "Mua ngay" → mở Shopee + có row mới:
   ```sql
   select sub_id, affiliate_url from public.affiliate_links order by created_at desc limit 3;
   ```
   Bấm lại trong 30 phút → **cùng `sub_id`** (không tạo row mới).
7. Đăng nhập account Google **khác** → mở `admin.html` phải bị chặn; gọi API xoá campaign phải bị RLS từ chối.
8. (Tuỳ chọn) Lấy `sub_id` vừa tạo, giả lập 1 dòng CSV có `Sub_id1` = giá trị đó → chạy import → phải sinh `orders` + `commission_ledger`.

---

## 9. Known issues / limitations

| Mức độ | Vấn đề | Hướng xử lý |
| :--- | :--- | :--- |
| minor | Chống publish trùng chỉ trong **1 phiên** (Set trong RAM). Mở browser/tab khác publish lại vẫn tạo bản trùng | Nếu cần triệt để: thêm `content_hash` + unique index ở DB |
| minor | `deal_guest` seed 1 lần với `affiliate_id` hardcode; link guest ở client build bằng `config.js` | Đổi affiliate ID phải sửa cả 3 nơi: `config.js`, RPC, seed SQL |
| minor | Parser luôn dùng **năm hiện tại** cho ngày `DD.MM` (deal tháng 12 sang tháng 1 sẽ lệch năm) | Sửa ngày trong preview trước khi publish |
| minor | `end_date` so sánh theo giờ local browser vs `current_date` UTC | Chấp nhận; nếu cần chính xác: dùng `Asia/Ho_Chi_Minh` |
| minor | `click_count` được tăng nhưng chưa hiển thị ở UI | Hiển thị "🔥 N lượt mua" nếu muốn |
| minor | `ADMIN_EMAILS` hardcode ở `admin-deals.js` + `auth.js` (chỉ UI) | Nguồn sự thật là `deal_admins` |
| minor | Danh sách campaign public/admin chưa phân trang (`limit 50` ở admin) | Thêm paging khi data lớn |
| minor | `deals.html` vẫn copy inline `openDrawer/updateDrawerUser` từ `main.js` (AGENTS.md §3.1) | Tách `drawer.js` dùng chung |
| minor | CTA sự kiện/voucher dùng `sub_id` sinh ở client, **không có row** trong `affiliate_links` → CSV import bỏ qua, đơn phát sinh từ trang sự kiện không cộng hoa hồng vào ví user (chỉ kích hoạt cookie affiliate) | Muốn cộng ví: thêm RPC `generate_action_link(p_url)` tạo row `affiliate_links` như `generate_deal_affiliate_link` |
| minor | Admin hiển thị `end_date` dạng ISO | Format `dd/mm` |

---

## 10. Bảo trì

| Việc | Cần làm |
| :--- | :--- |
| Sửa CSS/JS | Bump `?v=` trong **5 file HTML** (`index`, `referral`, `refund`, `deals`, `admin`) để tránh cache |
| Thêm cột vào `deal_campaigns` | `grant select (ten_cot) ... to anon, authenticated;` (xem §4.3) |
| Đổi affiliate ID | `assets/js/config.js` + hằng `c_affiliate_id` trong RPC + seed `deal_guest` + secret `SHOPEE_AFFILIATE_ID` của edge function |
| Thêm admin | INSERT vào `deal_admins` (§7) |
| Chạy migration | `202610170001 → 202610180001 → 202610190001 → 202610200001 → 202610230001` (`supabase db push`) |
| Đổi fixture test | `plans/deal_hot.txt` là input của `deal-parser.test.js` — sửa fixture phải sửa assert |

---

## 11. Lịch sử thay đổi (changelog)

| Đợt | Nội dung |
| :--- | :--- |
| v1 | Schema + parser + trang admin/public + RPC bản đầu (`p_affiliate_url` do client gửi) |
| v2 (hardening) | RLS admin thật (`deal_admins`); RPC tự sinh `sub_id` + URL (bỏ tham số URL từ client); CHECK ngày/category; index sort; seed `deal_guest`; chống spam bằng reuse 30' + dedupe click; ẩn `raw_content`; sửa parser (ngày/brand/tên SP/voucher); publish rollback + retry; event delegation; `waitForAuth`; aria cho header/drawer; dialog xác nhận; responsive admin |
| v3 (UI grid) | Sửa tràn ngang product grid (`min-width: 0`, `minmax(0,1fr)`); nút mua wrap/stack; clamp tên SP đúng (inner span + `lh`); badge thẳng hàng |
| v4 (nav) | Bỏ "Tính năng"/"Cách hoạt động" khỏi desktop nav + drawer (đồng bộ 4 trang); xoá rule ẩn `nth-child` trong `responsive.css` |
| v6 (action links) | Thêm cột `action_links` (migration `202610230001`): link `/m/`, `/user/voucher-wallet/`, `?shopCollection=` hiện thành CTA thay vì bị nuốt; parser nhận thêm `/product/<shopId>/<itemId>` và mọi dạng `<slug>-i.<shopId>.<itemId>`; `store_url` loại trừ link sản phẩm/landing; nút gian hàng bọc affiliate; sửa giá `1.5 triệu`/`13.6 inch` bị đọc thành ngày làm deal hiện "Đã kết thúc" oan |
| v5 (post voucher) | Bắt mã voucher dạng `🎟️ CODE` (không có "Mã:"); post không có link sản phẩm + tiêu đề nhắc voucher → category `Voucher`; không lặp mã/mô tả voucher trong highlights; bỏ footer rỗng khi campaign không có `store_url`; voucher chip không bị bóp chữ trên mobile |
