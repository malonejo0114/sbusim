ALTER TABLE "ScheduledPost"
ADD COLUMN "publishedAt" TIMESTAMP(3);

UPDATE "ScheduledPost"
SET "publishedAt" = "scheduledAt"
WHERE "publishedAt" IS NULL
  AND "remotePostId" IS NOT NULL;

CREATE INDEX "ScheduledPost_threadsAccountId_publishedAt_idx"
ON "ScheduledPost"("threadsAccountId", "publishedAt");
