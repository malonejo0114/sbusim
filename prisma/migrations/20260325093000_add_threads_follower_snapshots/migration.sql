CREATE TABLE "ThreadsFollowerSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadsAccountId" TEXT NOT NULL,
    "dateKst" VARCHAR(10) NOT NULL,
    "followerCount" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadsFollowerSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThreadsFollowerSnapshot_threadsAccountId_dateKst_key" ON "ThreadsFollowerSnapshot"("threadsAccountId", "dateKst");
CREATE INDEX "ThreadsFollowerSnapshot_userId_dateKst_idx" ON "ThreadsFollowerSnapshot"("userId", "dateKst");
CREATE INDEX "ThreadsFollowerSnapshot_threadsAccountId_capturedAt_idx" ON "ThreadsFollowerSnapshot"("threadsAccountId", "capturedAt");

ALTER TABLE "ThreadsFollowerSnapshot"
ADD CONSTRAINT "ThreadsFollowerSnapshot_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ThreadsFollowerSnapshot"
ADD CONSTRAINT "ThreadsFollowerSnapshot_threadsAccountId_fkey"
FOREIGN KEY ("threadsAccountId") REFERENCES "ThreadsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
