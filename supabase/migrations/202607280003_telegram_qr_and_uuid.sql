-- Migration: Set payout-qr bucket to public and update Telegram notification to include User UUID & QR photo
update storage.buckets set public = true where id = 'payout-qr';

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
  v_qr_path text;
  v_qr_url text := null;
  v_formatted_amount text;
begin
  -- Lấy thông tin user từ bảng profiles
  select 
    email, 
    full_name, 
    payout_recipient_name,
    payout_qr_path
  into 
    v_user_email, 
    v_full_name, 
    v_recipient_name,
    v_qr_path
  from public.profiles 
  where id = NEW.user_id;

  -- Làm tròn số tiền (round) và định dạng phân cách hàng nghìn bằng dấu chấm (.)
  -- Ví dụ: 97131.61 -> 97.132 | 136842.74 -> 136.843
  v_formatted_amount := replace(to_char(round(NEW.amount), 'FM999,999,999,999'), ',', '.');

  -- Tạo URL ảnh QR nếu user đã upload
  if v_qr_path is not null and v_qr_path != '' then
    v_qr_url := 'https://zgdnjlqqgxfpeizaawat.supabase.co/storage/v1/object/public/payout-qr/' || v_qr_path;
  end if;

  -- Soạn nội dung tin nhắn Telegram
  v_message := format(
    '💸 *YÊU CẦU RÚT TIỀN MỚI!*' || chr(10) || chr(10) ||
    '👤 *Họ tên:* %s' || chr(10) ||
    '🆔 *User UUID:* `%s`' || chr(10) ||
    '📧 *Email:* %s' || chr(10) ||
    '🏦 *Tên TK nhận:* %s' || chr(10) ||
    '💰 *Số tiền rút:* %s VNĐ' || chr(10) ||
    '🆔 *Mã yêu cầu:* `%s`' || chr(10) ||
    '📅 *Thời gian:* %s',
    coalesce(v_full_name, 'Chưa cập nhật'),
    NEW.user_id,
    coalesce(v_user_email, 'N/A'),
    coalesce(v_recipient_name, 'Chưa cập nhật'),
    v_formatted_amount,
    NEW.id,
    to_char(coalesce(NEW.created_at, now()) at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS DD/MM/YYYY')
  );

  -- Gửi thông báo kèm ảnh QR nếu có, ngược lại gửi tin nhắn văn bản
  if v_qr_url is not null then
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || v_bot_token || '/sendPhoto',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'chat_id', v_chat_id,
        'photo', v_qr_url,
        'caption', v_message,
        'parse_mode', 'Markdown'
      )
    );
  else
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'chat_id', v_chat_id,
        'text', v_message,
        'parse_mode', 'Markdown'
      )
    );
  end if;

  return NEW;
end;
$$;
