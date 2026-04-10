-- Refresh RSS defaults for RSS-only automation mode.
-- Keeps chart/calendar/cot disabled and stabilizes feed list.

-- Disable known legacy/unstable URLs if present.
update content_sources
set enabled = false, updated_at = now()
where type = 'rss'
  and url in (
    'https://www.cmegroup.com/media-room/rss.html',
    'https://www.investing.com/rss/news_285.rss'
  );

-- Ensure recommended RSS feeds are enabled.
insert into content_sources (type, name, url, enabled)
select 'rss', 'Investing Commodities RSS', 'https://www.investing.com/rss/news_11.rss', true
where not exists (
  select 1 from content_sources where url = 'https://www.investing.com/rss/news_11.rss'
);

update content_sources
set type = 'rss', name = 'Investing Commodities RSS', enabled = true, updated_at = now()
where url = 'https://www.investing.com/rss/news_11.rss';

insert into content_sources (type, name, url, enabled)
select 'rss', 'Federal Reserve Monetary Policy RSS', 'https://www.federalreserve.gov/feeds/press_monetary.xml', true
where not exists (
  select 1 from content_sources where url = 'https://www.federalreserve.gov/feeds/press_monetary.xml'
);

update content_sources
set type = 'rss', name = 'Federal Reserve Monetary Policy RSS', enabled = true, updated_at = now()
where url = 'https://www.federalreserve.gov/feeds/press_monetary.xml';

insert into content_sources (type, name, url, enabled)
select 'rss', 'EIA Today in Energy RSS', 'https://www.eia.gov/rss/todayinenergy.xml', true
where not exists (
  select 1 from content_sources where url = 'https://www.eia.gov/rss/todayinenergy.xml'
);

update content_sources
set type = 'rss', name = 'EIA Today in Energy RSS', enabled = true, updated_at = now()
where url = 'https://www.eia.gov/rss/todayinenergy.xml';

insert into content_sources (type, name, url, enabled)
select 'rss', 'CFTC Enforcement RSS', 'https://www.cftc.gov/RSS/RSSENF/rssenf.xml', true
where not exists (
  select 1 from content_sources where url = 'https://www.cftc.gov/RSS/RSSENF/rssenf.xml'
);

update content_sources
set type = 'rss', name = 'CFTC Enforcement RSS', enabled = true, updated_at = now()
where url = 'https://www.cftc.gov/RSS/RSSENF/rssenf.xml';

insert into content_sources (type, name, url, enabled)
select 'rss', 'CME Press Releases RSS', 'https://feeds.feedburner.com/mediaroom/CMsF', true
where not exists (
  select 1 from content_sources where url = 'https://feeds.feedburner.com/mediaroom/CMsF'
);

update content_sources
set type = 'rss', name = 'CME Press Releases RSS', enabled = true, updated_at = now()
where url = 'https://feeds.feedburner.com/mediaroom/CMsF';
