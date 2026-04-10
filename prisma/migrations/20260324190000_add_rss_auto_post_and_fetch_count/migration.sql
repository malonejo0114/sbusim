ALTER TABLE "ThreadsAccount"
  ADD COLUMN IF NOT EXISTS "rssAutoPostEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "rssFetchCount" INTEGER NOT NULL DEFAULT 1;

UPDATE "ThreadsAccount"
SET "rssFetchCount" = 1
WHERE "rssFetchCount" < 1;
