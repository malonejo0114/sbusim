CREATE TABLE "CardNewsProject" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "brand" TEXT,
  "templateKey" TEXT NOT NULL,
  "backgroundImageUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardNewsProject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CardNewsProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CardNewsSlide" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "pageLabel" TEXT,
  "eyebrow" TEXT,
  "title" TEXT NOT NULL,
  "accentTitle" TEXT,
  "subtitle" TEXT,
  "body" TEXT,
  "quote" TEXT,
  "footer" TEXT,
  "statsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardNewsSlide_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CardNewsSlide_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CardNewsProject"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CardNewsProject_userId_updatedAt_idx" ON "CardNewsProject"("userId", "updatedAt");
CREATE UNIQUE INDEX "CardNewsSlide_projectId_orderIndex_key" ON "CardNewsSlide"("projectId", "orderIndex");
CREATE INDEX "CardNewsSlide_projectId_orderIndex_idx" ON "CardNewsSlide"("projectId", "orderIndex");

DROP TABLE IF EXISTS "CafeScheduledPost";
DROP TYPE IF EXISTS "CafeScheduledPostStatus";
