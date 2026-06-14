# Import Shopee Conversion CSV Để Theo Dõi Đơn Và Hoa Hồng User

## Summary

Hệ thống theo dõi đơn hàng sẽ dùng file CSV từ Shopee Affiliate `conversion_report` làm nguồn dữ liệu chính xác để đối soát hoa hồng. Bản đầu tiên dùng script local admin với `SUPABASE_SERVICE_ROLE_KEY`, lưu raw CSV để audit, sau đó normalize các dòng có `Sub_id1` match `affiliate_links.sub_id` vào `orders` và `commission_ledger`.

Click report chưa nằm trong phase này; conversion report là nguồn chuẩn để biết đơn, trạng thái và hoa hồng thực tế.

## Key Changes

- Database:
  - Thêm `shopee_conversion_imports` để lưu mỗi batch import: filename, row count, matched/unmatched count, normalized order count, status.
  - Thêm `shopee_conversion_rows` để lưu từng dòng CSV raw, các field Shopee chính, `Sub_id1..5`, raw JSON và thông tin match user/link.
  - Bổ sung `orders.commission_rate`, `orders.completed_at`, `orders.click_time`, `orders.checkout_id`.
  - Giữ `orders.shopee_order_id` unique theo schema hiện tại; import aggregate nhiều item rows cùng order id trước khi upsert.

- Import script:
  - Script local: `scripts/import-shopee-conversions.mjs`.
  - Usage:
    ```bash
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-shopee-conversions.mjs /path/AffiliateCommissionReport.csv
    ```
  - Parse CSV UTF-8 BOM, quote/comma-safe, không cần package ngoài.
  - Lưu toàn bộ rows vào `shopee_conversion_rows`.
  - Chỉ normalize rows có `Sub_id1` match `affiliate_links.sub_id`; rows không match vẫn được lưu raw để audit.
  - Aggregate nhiều dòng cùng `ID đơn hàng`: sum commission, giữ một order trong `orders`.

- Status và ledger:
  - `Đang chờ xử lý` -> `orders.status = pending`, ledger `pending`.
  - `Hoàn thành` -> `orders.status = approved`, ledger `approved`.
  - `Đã hủy` -> `orders.status = rejected`, ledger `rejected`, amount `0`.
  - Nếu order đã `paid`, import không hạ trạng thái để tránh trả tiền trùng.

- Frontend:
  - `loadLinkHistory()` lấy thêm orders theo `sub_id`.
  - Mỗi link vẫn hiển thị hoa hồng ước tính từ lúc convert.
  - Bên dưới mỗi link hiển thị đơn thực tế: mã đơn, item, trạng thái, thời gian mua, hoa hồng ròng, tổng hoa hồng.
  - Nếu link chưa có order: hiển thị `Chưa ghi nhận đơn hàng`.

## CSV Mapping

- `ID đơn hàng` -> `orders.shopee_order_id`
- `Checkout id` -> `orders.checkout_id`
- `Sub_id1` -> `orders.sub_id`
- `Item id` -> `orders.item_id`
- `Tên Item` -> `orders.item_name`
- `Thời Gian Đặt Hàng` -> `orders.purchase_time`
- `Thời gian hoàn thành` -> `orders.completed_at`
- `Thời gian Click` -> `orders.click_time`
- `Tổng hoa hồng đơn hàng(₫)` -> `orders.commission`
- `Hoa hồng ròng tiếp thị liên kết(₫)` -> `orders.net_commission`
- `Mức hoa hồng tiếp thị liên kết theo thỏa thuận` -> `orders.commission_rate`
- Toàn bộ dòng CSV -> `shopee_conversion_rows.raw_data`

## Test Plan

- Import file mẫu 153 rows:
  - Tạo 1 import batch.
  - Lưu đủ 153 raw rows.
  - Báo đúng matched/unmatched theo `Sub_id1`.
  - Không normalize rows có `Sub_id1` trống hoặc không match.
- CSV có nhiều dòng cùng `ID đơn hàng`: chỉ tạo/cập nhật 1 `orders` row, commission được sum đúng.
- Status mapping đúng cho `pending`, `approved`, `rejected`; order `paid` không bị hạ trạng thái khi re-import.
- Re-import cùng CSV không tạo duplicate `orders` hoặc `commission_ledger`.
- UI history:
  - Link chưa có order hiển thị `Chưa ghi nhận đơn hàng`.
  - Link có order hiển thị đúng đơn theo `sub_id`.
  - User không thấy đơn của user khác nhờ RLS `orders.user_id = auth.uid()`.

## Assumptions

- Conversion report là nguồn chuẩn để trả hoa hồng; click report chỉ làm analytics ở phase sau.
- App dùng `Sub_id1` để gửi tracking key dạng `u_<userShortId>_l_<linkShortId>`, nên import chỉ match bằng `Sub_id1`.
- Admin chạy import local bằng service role key; key này không commit vào repo và không đưa lên frontend.
- CSV hiện tại có nhiều dòng không có `Sub_id1`; các dòng đó chỉ được lưu raw để audit và không trả hoa hồng cho user nào.
