ALTER TABLE "ThreadsAccount"
  ADD COLUMN IF NOT EXISTS "rssAutoPostMinIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "rssAutoPostMaxIntervalMinutes" INTEGER NOT NULL DEFAULT 90;

UPDATE "ThreadsAccount"
SET
  "rssAutoPostMinIntervalMinutes" = GREATEST(1, LEAST("rssAutoPostMinIntervalMinutes", 1440)),
  "rssAutoPostMaxIntervalMinutes" = GREATEST(1, LEAST("rssAutoPostMaxIntervalMinutes", 1440));
