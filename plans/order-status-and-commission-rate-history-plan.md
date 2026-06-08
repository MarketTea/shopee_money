# Hiển Thị Trạng Thái Đơn Và % Hoa Hồng Trong Lịch Sử Link

## Summary

Có thể hiển thị trạng thái đơn và % hoa hồng trong "Lịch sử link của bạn", nhưng chỉ khi bảng `orders` đã có dữ liệu đơn hàng được import từ Shopee theo `sub_id`. UI sẽ nhóm các đơn dưới từng link affiliate, map status DB hiện có sang 4 trạng thái app, và thêm field `commission_rate` để hiển thị % hoa hồng chính xác.

## Key Changes

- Database:
  - Thêm migration mới bổ sung `orders.commission_rate numeric(5, 2) default null`.
  - Giữ `orders.status` hiện tại: `pending`, `approved`, `rejected`, `paid`.
  - Map UI:
    - `pending` -> `Đang chờ xử lý`
    - `approved` -> `Chưa thanh toán`
    - `paid` -> `Đã hoàn thành`
    - `rejected` -> `Đã huỷ`

- Frontend:
  - Đổi `loadLinkHistory()` để query `affiliate_links` kèm các `orders` cùng `sub_id`.
  - `renderHistory()` sẽ hiển thị mỗi link như hiện tại, bên dưới có danh sách đơn phát sinh.
  - Mỗi đơn hiển thị: tên sản phẩm, thời gian mua, trạng thái, `% hoa hồng`, tiền hoa hồng/hoàn tiền nếu có.
  - Nếu link chưa có đơn: hiện "Chưa ghi nhận đơn hàng".
  - Thêm CSS badge trạng thái và layout đơn hàng con dưới mỗi link.

- Data import requirement:
  - Khi import report Shopee, backend/admin phải lưu `sub_id`, `status`, `commission`, `net_commission`, `commission_rate`, `item_name`, `purchase_time` vào `orders`.
  - Nếu report chưa có `commission_rate`, UI hiển thị `--%` thay vì tự tính sai.

## Test Plan

- User chưa có order: lịch sử link vẫn hiển thị link và trạng thái "Chưa ghi nhận đơn hàng".
- User có nhiều link, mỗi link có nhiều order: order được nhóm đúng theo `sub_id`.
- Status hiển thị đúng 4 nhãn app theo mapping.
- `commission_rate = 7.5` hiển thị `7.5%`.
- `commission_rate = null` hiển thị `--%`.
- User chỉ thấy order của chính họ nhờ RLS `orders.user_id = auth.uid()`.

## Assumptions

- Không đổi enum/check constraint status hiện tại để tránh ảnh hưởng dữ liệu cũ.
- % hoa hồng được lấy từ Shopee report/import và lưu vào `orders.commission_rate`.
- Phần này chỉ hiển thị dữ liệu đã có trong `orders`; chưa tự động lấy đơn từ Shopee nếu chưa có job/import report.
