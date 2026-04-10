-- Account-level RSS review settings
ALTER TABLE "ThreadsAccount"
  ADD COLUMN IF NOT EXISTS "rssReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "rssKeywordIncludeCsv" TEXT,
  ADD COLUMN IF NOT EXISTS "rssKeywordExcludeCsv" TEXT;

CREATE INDEX IF NOT EXISTS "ThreadsAccount_userId_rssReviewEnabled_idx"
  ON "ThreadsAccount"("userId", "rssReviewEnabled");
