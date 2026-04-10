-- DropIndex
DROP INDEX "ThreadsAccount_userId_key";

-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN     "dailyTopicPlanId" TEXT;

-- AlterTable
ALTER TABLE "ThreadsAccount" ADD COLUMN     "label" TEXT,
ADD COLUMN     "proxyUrlEncrypted" TEXT,
ADD COLUMN     "threadsUsername" TEXT;

-- CreateTable
CREATE TABLE "DailyTopicPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadsAccountId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "promptHint" TEXT,
    "commentTemplate" TEXT,
    "scheduleHour" INTEGER NOT NULL DEFAULT 9,
    "scheduleMinute" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastGeneratedDate" TEXT,
    "lastGeneratedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyTopicPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyTopicPlan_userId_enabled_idx" ON "DailyTopicPlan"("userId", "enabled");

-- CreateIndex
CREATE INDEX "DailyTopicPlan_threadsAccountId_enabled_idx" ON "DailyTopicPlan"("threadsAccountId", "enabled");

-- CreateIndex
CREATE INDEX "ScheduledPost_dailyTopicPlanId_idx" ON "ScheduledPost"("dailyTopicPlanId");

-- CreateIndex
CREATE INDEX "ThreadsAccount_threadsUserId_idx" ON "ThreadsAccount"("threadsUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadsAccount_userId_threadsUserId_key" ON "ThreadsAccount"("userId", "threadsUserId");

-- AddForeignKey
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_dailyTopicPlanId_fkey" FOREIGN KEY ("dailyTopicPlanId") REFERENCES "DailyTopicPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTopicPlan" ADD CONSTRAINT "DailyTopicPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTopicPlan" ADD CONSTRAINT "DailyTopicPlan_threadsAccountId_fkey" FOREIGN KEY ("threadsAccountId") REFERENCES "ThreadsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

