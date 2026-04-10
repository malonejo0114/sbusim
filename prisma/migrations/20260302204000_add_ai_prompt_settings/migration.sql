CREATE TABLE "AiPromptSetting" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiPromptSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiPromptSetting_userId_key_key" ON "AiPromptSetting"("userId", "key");
CREATE INDEX "AiPromptSetting_userId_updatedAt_idx" ON "AiPromptSetting"("userId", "updatedAt");

ALTER TABLE "AiPromptSetting"
ADD CONSTRAINT "AiPromptSetting_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
