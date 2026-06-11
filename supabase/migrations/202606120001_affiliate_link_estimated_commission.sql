alter table public.affiliate_links
  add column if not exists estimated_commission text,
  add column if not exists commission_rate text,
  add column if not exists product_name text,
  add column if not exists product_image text;
