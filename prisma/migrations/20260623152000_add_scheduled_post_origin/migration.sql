ALTER TABLE "ScheduledPost"
ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'SBUSIM';

CREATE INDEX "ScheduledPost_threadsAccountId_remotePostId_idx"
ON "ScheduledPost"("threadsAccountId", "remotePostId");

CREATE INDEX "ScheduledPost_origin_scheduledAt_idx"
ON "ScheduledPost"("origin", "scheduledAt");
