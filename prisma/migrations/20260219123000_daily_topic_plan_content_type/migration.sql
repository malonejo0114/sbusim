DO $$
BEGIN
  CREATE TYPE "DailyTopicPlanContentType" AS ENUM ('TOPIC', 'INFO', 'CTA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "DailyTopicPlan"
  ADD COLUMN IF NOT EXISTS "contentType" "DailyTopicPlanContentType" NOT NULL DEFAULT 'TOPIC',
  ADD COLUMN IF NOT EXISTS "ctaText" TEXT;
