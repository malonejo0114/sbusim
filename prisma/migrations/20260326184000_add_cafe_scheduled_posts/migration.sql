DO $$
BEGIN
  CREATE TYPE "CafeScheduledPostStatus" AS ENUM ('QUEUED', 'POSTING', 'POSTED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CafeScheduledPost" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetAccountId" TEXT,
  "title" TEXT NOT NULL,
  "contentHtml" TEXT NOT NULL,
  "charCount" INTEGER NOT NULL,
  "status" "CafeScheduledPostStatus" NOT NULL DEFAULT 'QUEUED',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "postedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "imageMetaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CafeScheduledPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CafeScheduledPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CafeScheduledPost_targetAccountId_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "ThreadsAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CafeScheduledPost_userId_scheduledAt_idx" ON "CafeScheduledPost"("userId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "CafeScheduledPost_status_scheduledAt_idx" ON "CafeScheduledPost"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "CafeScheduledPost_targetAccountId_scheduledAt_idx" ON "CafeScheduledPost"("targetAccountId", "scheduledAt");
