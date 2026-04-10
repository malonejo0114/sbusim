CREATE TABLE IF NOT EXISTS "NaverAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT,
  "naverUserId" TEXT,
  "naverEmail" TEXT,
  "naverNickname" TEXT,
  "accessTokenEncrypted" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NaverAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NaverAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "NaverAccount_userId_idx" ON "NaverAccount"("userId");
CREATE INDEX IF NOT EXISTS "NaverAccount_naverUserId_idx" ON "NaverAccount"("naverUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "NaverAccount_userId_naverUserId_key" ON "NaverAccount"("userId", "naverUserId");

ALTER TABLE "CafeScheduledPost" DROP CONSTRAINT IF EXISTS "CafeScheduledPost_targetAccountId_fkey";
DROP INDEX IF EXISTS "CafeScheduledPost_targetAccountId_scheduledAt_idx";

ALTER TABLE "CafeScheduledPost" ADD COLUMN IF NOT EXISTS "targetNaverAccountId" TEXT;

ALTER TABLE "CafeScheduledPost"
  ADD CONSTRAINT "CafeScheduledPost_targetNaverAccountId_fkey"
  FOREIGN KEY ("targetNaverAccountId") REFERENCES "NaverAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "CafeScheduledPost_targetNaverAccountId_scheduledAt_idx"
  ON "CafeScheduledPost"("targetNaverAccountId", "scheduledAt");

ALTER TABLE "CafeScheduledPost" DROP COLUMN IF EXISTS "targetAccountId";
