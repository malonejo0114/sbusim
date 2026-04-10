CREATE TABLE "DashboardLoginAccount" (
  "id" TEXT NOT NULL,
  "loginId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "canonicalLoginId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardLoginAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardLoginAccount_loginId_key" ON "DashboardLoginAccount"("loginId");
CREATE INDEX "DashboardLoginAccount_enabled_createdAt_idx" ON "DashboardLoginAccount"("enabled", "createdAt");
