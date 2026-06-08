alter table public.profiles
  add column if not exists payout_recipient_name text,
  add column if not exists payout_qr_path text,
  add column if not exists payout_qr_uploaded_at timestamptz;

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payout-qr',
  'payout-qr',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their own payout QR" on storage.objects;
create policy "Users can read their own payout QR"
  on storage.objects for select
  using (
    bucket_id = 'payout-qr'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can upload their own payout QR" on storage.objects;
create policy "Users can upload their own payout QR"
  on storage.objects for insert
  with check (
    bucket_id = 'payout-qr'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update their own payout QR" on storage.objects;
create policy "Users can update their own payout QR"
  on storage.objects for update
  using (
    bucket_id = 'payout-qr'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'payout-qr'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete their own payout QR" on storage.objects;
create policy "Users can delete their own payout QR"
  on storage.objects for delete
  using (
    bucket_id = 'payout-qr'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
