import "dotenv/config";

import { Worker } from "bullmq";
import {
  ensureDailyTopicPlannerJob,
  ensureInsightsSyncJob,
  ensurePostQueueDispatchJob,
  ensureRssReviewHourlyJob,
  SBUSIM_QUEUE_NAME,
} from "@/server/queue";
import { getRedisConnection } from "@/server/redis";
import {
  handleCommentJob,
  handleDailyTopicPlannerJob,
  handleInsightJob,
  handleInsightsSyncJob,
  handlePostQueueDispatchJob,
  handlePublishJob,
  handleRssReviewHourlyJob,
} from "@/server/jobHandlers";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  // Ensure required env exists early for a clearer failure mode.
  requireEnv("DATABASE_URL");
  requireEnv("REDIS_URL");
  requireEnv("ENCRYPTION_KEY");
  requireEnv("THREADS_APP_ID");
  requireEnv("THREADS_APP_SECRET");

  const connection = getRedisConnection();

  const worker = new Worker(
    SBUSIM_QUEUE_NAME,
    async (job) => {
      if (job.name === "daily-topic-planner") return handleDailyTopicPlannerJob();
      if (job.name === "insights-sync") return handleInsightsSyncJob();
      if (job.name === "rss-review-hourly") return handleRssReviewHourlyJob();
      if (job.name === "post-queue-dispatch") return handlePostQueueDispatchJob();

      const scheduledPostId = (job.data as { scheduledPostId?: string })?.scheduledPostId;
      if (!scheduledPostId) throw new Error("Missing scheduledPostId in job data");

      if (job.name === "publish") return handlePublishJob(scheduledPostId);
      if (job.name === "comment") return handleCommentJob(scheduledPostId);
      if (job.name === "insight") return handleInsightJob(scheduledPostId);

      throw new Error(`Unknown job name: ${job.name}`);
    },
    { connection, concurrency: 5 }
  );

  worker.on("completed", (job) => {
    console.log(`[worker] completed ${job.name} ${job.id}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] failed ${job?.name} ${job?.id}:`, err);
  });
  worker.on("error", (err) => {
    console.error("[worker] error:", err);
  });

  const shutdown = async () => {
    console.log("[worker] shutting down...");
    await worker.close();
    await connection.quit();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await ensureDailyTopicPlannerJob();
  await ensureInsightsSyncJob();
  await ensureRssReviewHourlyJob();
  await ensurePostQueueDispatchJob();

  console.log("[worker] running. queue:", SBUSIM_QUEUE_NAME);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
