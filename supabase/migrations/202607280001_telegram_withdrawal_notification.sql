-- Migration: Add Telegram Notification trigger on new withdrawal request
-- Bật extension pg_net để gửi HTTP POST request từ Supabase Postgres
create extension if not exists pg_net with schema extensions;

-- Hàm gửi thông báo qua Telegram khi có lệnh rút tiền mới
create or replace function public.notify_telegram_withdrawal()
returns trigger
language plpgsql
security definer
as $$
declare
  v_bot_token text := '8505662704:AAHnEZos0PyV6pp7zVynKTKVsgjUCGNt7as';
  v_chat_id text := '1292564132';
  v_message text;
  v_user_email text;
  v_full_name text;
  v_recipient_name text;
  v_formatted_amount text;
begin
  -- Lấy thông tin user từ bảng profiles
  select 
    email, 
    full_name, 
    payout_recipient_name
  into 
    v_user_email, 
    v_full_name, 
    v_recipient_name
  from public.profiles 
  where id = NEW.user_id;

  -- Làm tròn số tiền (round) và định dạng phân cách hàng nghìn bằng dấu chấm (.)
  -- Ví dụ: 97131.61 -> 97.132 | 136842.74 -> 136.843
  v_formatted_amount := replace(to_char(round(NEW.amount), 'FM999,999,999,999'), ',', '.');

  -- Soạn nội dung tin nhắn Telegram (Dùng chr(10) thay cho %0A để tránh lỗi PostgreSQL format())
  v_message := format(
    '💸 *YÊU CẦU RÚT TIỀN MỚI!*' || chr(10) || chr(10) ||
    '👤 *Họ tên:* %s' || chr(10) ||
    '📧 *Email:* %s' || chr(10) ||
    '🏦 *Tên TK nhận:* %s' || chr(10) ||
    '💰 *Số tiền rút:* %s VNĐ' || chr(10) ||
    '🆔 *Mã yêu cầu:* `%s`' || chr(10) ||
    '📅 *Thời gian:* %s',
    coalesce(v_full_name, 'Chưa cập nhật'),
    coalesce(v_user_email, 'N/A'),
    coalesce(v_recipient_name, 'Chưa cập nhật'),
    v_formatted_amount,
    NEW.id,
    to_char(coalesce(NEW.created_at, now()) at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS DD/MM/YYYY')
  );

  -- Gửi HTTP POST request tới Telegram API
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'chat_id', v_chat_id,
      'text', v_message,
      'parse_mode', 'Markdown'
    )
  );

  return NEW;
end;
$$;

-- Gắn trigger vào bảng withdrawal_requests
drop trigger if exists on_withdrawal_request_created on public.withdrawal_requests;
create trigger on_withdrawal_request_created
  after insert on public.withdrawal_requests
  for each row
  execute function public.notify_telegram_withdrawal();
