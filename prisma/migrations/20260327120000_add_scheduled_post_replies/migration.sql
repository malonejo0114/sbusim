CREATE TYPE "ScheduledReplyStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

CREATE TABLE "ScheduledPostReply" (
    "id" TEXT NOT NULL,
    "scheduledPostId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "status" "ScheduledReplyStatus" NOT NULL DEFAULT 'PENDING',
    "remoteReplyId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPostReply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduledPostReply_scheduledPostId_orderIndex_key" ON "ScheduledPostReply"("scheduledPostId", "orderIndex");
CREATE INDEX "ScheduledPostReply_scheduledPostId_orderIndex_idx" ON "ScheduledPostReply"("scheduledPostId", "orderIndex");
CREATE INDEX "ScheduledPostReply_status_scheduledPostId_idx" ON "ScheduledPostReply"("status", "scheduledPostId");

ALTER TABLE "ScheduledPostReply"
ADD CONSTRAINT "ScheduledPostReply_scheduledPostId_fkey"
FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
