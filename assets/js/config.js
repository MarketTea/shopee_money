/* ── CONFIG ── */
const SUPABASE_URL = 'https://zgdnjlqqgxfpeizaawat.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnZG5qbHFxZ3hmcGVpemFhd2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDc5NTMsImV4cCI6MjA5NTk4Mzk1M30.tMNEc82u8lxpBY3zkan5uH5G3WeETQVwuqLWHfhtpWw';
const SUPABASE_READY = SUPABASE_URL.startsWith('https://') &&
  !SUPABASE_URL.includes('YOUR_PROJECT_REF') &&
  !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY');
const supabaseClient = SUPABASE_READY && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
const PAYOUT_QR_BUCKET = 'payout-qr';
const PAYOUT_QR_MAX_BYTES = 2 * 1024 * 1024;
const PAYOUT_QR_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
let currentUser = null;
let currentAffiliateLinkId = null;
let payoutQrFile = null;
let payoutPreviewObjectUrl = null;
// Cấu hình mã giới thiệu động (tự động thay đổi theo ngày)
const REFERRAL_CONFIG = {
  defaultCode: '4TVCRM7',

  // Danh sách mã xoay vòng theo thứ trong tuần (0: Chủ Nhật, 1: Thứ 2, ..., 6: Thứ 7)
  weeklyCodes: [
    '4TVCRM7',
  ],

  // Mã đặc biệt dành riêng cho các ngày Siêu Sale lớn (Định dạng: YYYY-MM-DD)
  specialDates: {
    '2026-06-06': 'MEGA_66_SALE',
    '2026-07-07': 'MEGA_77_SALE',
    '2026-08-08': 'MEGA_88_SALE',
    '2026-09-09': 'MEGA_99_SALE',
    '2026-10-10': 'MEGA_1010_SALE',
    '2026-11-11': 'MEGA_1111_SALE',
    '2026-12-12': 'MEGA_1212_SALE'
  }
};
