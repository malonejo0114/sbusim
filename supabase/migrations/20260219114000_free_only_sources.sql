-- Free-only defaults:
-- 1) disable Trading Economics sources (paid)
-- 2) disable broken CME RSS URL
-- 3) enable stable free RSS feeds

update content_sources
set enabled = false, updated_at = now()
where type = 'tradingeconomics';

update content_sources
set enabled = false, updated_at = now()
where type = 'rss' and url like '%cmegroup.com%';

insert into content_sources (type, name, url, enabled)
select 'rss', 'Investing.com All News RSS', 'https://www.investing.com/rss/news.rss', true
where not exists (
  select 1 from content_sources where url = 'https://www.investing.com/rss/news.rss'
);

insert into content_sources (type, name, url, enabled)
select 'rss', 'Investing.com Most Popular RSS', 'https://www.investing.com/rss/news_285.rss', true
where not exists (
  select 1 from content_sources where url = 'https://www.investing.com/rss/news_285.rss'
);

insert into content_sources (type, name, url, enabled)
select 'rss', 'MarketWatch Top Stories RSS', 'https://www.marketwatch.com/rss/topstories', true
where not exists (
  select 1 from content_sources where url = 'https://www.marketwatch.com/rss/topstories'
);

insert into content_sources (type, name, url, enabled)
select 'rss', 'Federal Reserve Press Releases RSS', 'https://www.federalreserve.gov/feeds/press_all.xml', true
where not exists (
  select 1 from content_sources where url = 'https://www.federalreserve.gov/feeds/press_all.xml'
);
