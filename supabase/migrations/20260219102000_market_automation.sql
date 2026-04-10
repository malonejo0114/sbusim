create extension if not exists pgcrypto;

-- enums
create type content_source_type as enum ('tradingeconomics','cftc','rss');
create type chart_kind_type as enum ('daily_snapshot_4pack','single_instrument_7d');
create type post_platform_type as enum ('threads');
create type post_type_type as enum ('daily_snapshot','daily_calendar','weekly_cot','rss_insight');
create type post_status_type as enum ('queued','rendering','posting','posted','failed');

-- 1) content_sources
create table if not exists content_sources (
  id uuid primary key default gen_random_uuid(),
  type content_source_type not null,
  name text not null,
  url text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) market_instruments
create table if not exists market_instruments (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  te_symbol text not null,
  category text not null,
  enabled boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(te_symbol)
);

-- 3) market_snapshots
create table if not exists market_snapshots (
  id uuid primary key default gen_random_uuid(),
  asof_date date not null,
  instrument_id uuid not null references market_instruments(id) on delete cascade,
  last numeric,
  daily_pct numeric,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(asof_date, instrument_id)
);
create index if not exists idx_market_snapshots_asof on market_snapshots(asof_date desc);

-- 4) market_charts
create table if not exists market_charts (
  id uuid primary key default gen_random_uuid(),
  asof_date date not null,
  chart_kind chart_kind_type not null,
  image_url text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_market_charts_asof on market_charts(asof_date desc, chart_kind);

-- 5) economic_events
create table if not exists economic_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  event_time timestamptz,
  country text,
  event text,
  importance int,
  source_url text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_economic_events_date on economic_events(event_date desc);

-- 6) cot_snapshots
create table if not exists cot_snapshots (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  market_code text not null,
  net_noncommercial numeric,
  net_change_wow numeric,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(report_date, market_code)
);
create index if not exists idx_cot_snapshots_report_date on cot_snapshots(report_date desc);

-- 7) rss_items
create table if not exists rss_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references content_sources(id) on delete cascade,
  guid text not null,
  title text,
  link text,
  published_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(source_id, guid)
);
create index if not exists idx_rss_items_published_at on rss_items(published_at desc);

-- 8) post_queue
create table if not exists post_queue (
  id uuid primary key default gen_random_uuid(),
  platform post_platform_type not null default 'threads',
  post_type post_type_type not null,
  dedupe_key text,
  scheduled_at timestamptz not null,
  status post_status_type not null default 'queued',
  text text not null,
  media_url text,
  sources jsonb not null default '[]'::jsonb,
  hide_sources boolean not null default false,
  error text,
  retries int not null default 0,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(dedupe_key)
);
create index if not exists idx_post_queue_schedule on post_queue(status, scheduled_at);
create index if not exists idx_post_queue_type_date on post_queue(post_type, created_at desc);

-- 9) post_logs
create table if not exists post_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references post_queue(id) on delete cascade,
  step text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_post_logs_post_id on post_logs(post_id, created_at desc);

-- seed sources (safe upsert pattern)
insert into content_sources (type, name, url, enabled)
values
  ('tradingeconomics', 'Trading Economics Markets', 'https://api.tradingeconomics.com/markets/snapshot', true),
  ('tradingeconomics', 'Trading Economics Calendar', 'https://api.tradingeconomics.com/calendar', true),
  ('cftc', 'CFTC Public Reporting', 'https://publicreporting.cftc.gov', true),
  ('rss', 'CME Group Newsroom RSS', 'https://www.cmegroup.com/media-room/rss.html', true),
  ('rss', 'Investing.com News RSS', 'https://www.investing.com/rss/news.rss', true)
on conflict do nothing;

insert into market_instruments (label, te_symbol, category, enabled, sort)
values
  ('S&P 500', 'US500', 'index', true, 10),
  ('DXY', 'DXY', 'currency', true, 20),
  ('WTI', 'CRUDE', 'commodity', true, 30),
  ('Gold', 'XAUUSD', 'commodity', true, 40)
on conflict (te_symbol) do nothing;
