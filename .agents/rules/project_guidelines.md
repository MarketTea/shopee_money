# Quy tắc & Hướng dẫn phát triển dự án HoanTienNgay (Shopee Money)

Tài liệu này là quy chuẩn bắt buộc mà AI Assistant (Antigravity) cần đọc và tuân thủ mỗi khi chỉnh sửa UI hoặc logic trong dự án này.

---

## 1. Cấu trúc trang & Phân chia chức năng

Dự án là ứng dụng Web đa trang (Multi-Page App) sử dụng HTML, CSS thuần và JavaScript kết nối Supabase Backend:

| File | Chức năng chính | Script phụ thuộc |
| :--- | :--- | :--- |
| `index.html` | Chuyển đổi link Shopee Affiliate, xem lịch sử link đã chuyển đổi. | `config.js`, `utils.js`, `auth.js`, `shopee.js`, `converter.js`, `history.js`, `referral.js`, `main.js` |
| `referral.html` | Chương trình giới thiệu bạn bè, mã giới thiệu, thống kê hoa hồng từ bạn bè. | `config.js`, `utils.js`, `auth.js`, `referral.js`, `main.js` |
| `refund.html` | Quản lý hoàn tiền, cài đặt thông tin nhận tiền / mã QR ngân hàng, theo dõi đơn hàng, gửi yêu cầu rút tiền & lịch sử rút tiền. | `config.js`, `utils.js`, `auth.js`, `payout.js`, `withdrawal.js`, `main.js` |

---

## 2. Quy tắc tổ chức CSS & Design System

### Design Language (Neo-Brutalism & Modern Flat)
- **Bảng màu chủ đạo:**
  - `var(--orange)`: `#ee4d2d` (Cam Shopee / Điểm nhấn chính / Active menu)
  - `var(--yellow)`: `#FFDE00` (Vàng nút CTA `.btn-convert`, `.nav-cta`)
  - `var(--bg)`: `#FFF4E0` (Nền trang màu kem nhẹ)
  - `var(--border-thin)`: `2px solid #000`
  - `var(--border-thick)`: `3px solid #000`
  - `var(--shadow-sm)`: `2px 2px 0px #000`
  - `var(--shadow-md)`: `4px 4px 0px #000`
  - `var(--shadow-lg)`: `8px 8px 0px #000`

### Phân chia CSS:
1. **`assets/css/base.css`**:
   - Chứa CSS variables (`:root`), font, reset, background pattern.
   - **Các class dùng chung toàn bộ trang** như `.btn-convert`, `.btn-convert:disabled`, `.spinner`, `@keyframes spin` **PHẢI** được đặt ở đây.
2. **`assets/css/header.css`**:
   - Header, Desktop Nav, Mobile Drawer, Menu User / Auth Pill.
   - Mục menu đang active **BẮT BUỘC** có class `.nav-active-link` (hoặc `.active`), hiển thị màu cam đậm (`color: var(--orange) !important; font-weight: 800 !important;`).
3. **`assets/css/payout.css`**:
   - Chứa style cho Dialog (`.payout-dialog`), Modal Rút tiền (`.withdraw-dialog`), Payout Dashboard, bảng chi tiết đơn hàng hoàn tiền.
4. **`assets/css/referral.css`**:
   - Chứa style thẻ 3 bước (`.ref-step-card`), Auth panel (`.ref-auth-card`), bảng thống kê giới thiệu.

---

## 3. Quy tắc JavaScript & Logic nghiệp vụ

### 1. Hàm dùng chung (Shared Utilities)
- **Tất cả các hàm tiện ích dùng ở nhiều trang PHẢI nằm trong `assets/js/utils.js`**:
  - `escapeHtml(value)`: Xử lý XSS.
  - `formatCurrency(value)`: Định dạng tiền tệ Việt Nam (VD: `14.100đ`).
  - `getOrderStatusMeta(status)`: Định dạng nhãn và class trạng thái đơn hàng (`pending`, `approved`, `paid`, `rejected`).
  - `showToast(message)`: Hiển thị thông báo toast.
- **KHÔNG** định nghĩa các hàm dùng chung cục bộ trong file riêng (như `history.js` hay `payout.js`) vì các trang khác khi gọi sẽ bị lỗi `ReferenceError`.

### 2. Quản lý Auth & Trạng thái người dùng
- Kiểm tra `currentUser` trước khi thực hiện các API yêu cầu đăng nhập.
- Khi đăng nhập/đăng xuất thành công, luôn gọi:
  - `updateAuthUi()`: Ẩn/hiện Auth Panel và nút đăng nhập/đăng xuất.
  - `updateDrawerUser()`: Cập nhật thông tin avatar, tên, email trong Mobile Drawer.
- Các hàm tải dữ liệu (`loadPayoutProfile`, `loadWithdrawData`, `loadLinkHistory`, `loadReferralStats`) phải có guard `if (!supabaseClient || !currentUser) return;`.

### 3. Quy tắc Modals & Dialogs
- Tất cả các modal sử dụng thẻ HTML5 `<dialog class="payout-dialog">`.
- Luôn hỗ trợ cả 2 phương thức mở modal:
  ```javascript
  if (typeof modal.showModal === 'function') {
    modal.showModal();
  } else {
    modal.classList.add('show');
  }
  ```
- Có sự kiện `window.addEventListener('click', ...)` để đóng modal khi click vào backdrop.

### 4. Đồng bộ Navigation & Drawer trên tất cả các trang
Khi thêm, sửa hoặc đổi tên trang:
- Cập nhật đồng thời thanh menu desktop (`<nav class="desktop-nav">`) và menu mobile (`<nav class="drawer-nav">`) ở cả 3 file: `index.html`, `referral.html`, `refund.html`.
- Đảm bảo thẻ `<a>` của trang hiện tại có class `nav-active-link` (hoặc `class="active"` trong drawer).

---

## 4. Checklist kiểm tra trước khi hoàn thành công việc
1. [ ] Không có lỗi console (`ReferenceError`, `TypeError`, `404`).
2. [ ] Kiểm tra hiển thị trên cả desktop và mobile drawer.
3. [ ] Nút CTA và spinner hiển thị đúng style vàng viền đen.
4. [ ] Tab / Link của trang hiện tại được sáng màu cam.
5. [ ] Dữ liệu Supabase tải và render đúng cho cả trạng thái đã login và chưa login.
