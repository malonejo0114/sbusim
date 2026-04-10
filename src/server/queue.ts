import { Queue } from "bullmq";
import { getRedisConnection } from "@/server/redis";
import { optionalEnv } from "@/server/env";

export const SBUSIM_QUEUE_NAME = optionalEnv("SBUSIM_QUEUE_NAME") ?? "sbusim";

let _queue: Queue | null = null;

function getQueue() {
  if (_queue) return _queue;
  _queue = new Queue(SBUSIM_QUEUE_NAME, {
    connection: getRedisConnection(),
  });
  return _queue;
}

export async function enqueuePublishJob(args: { scheduledPostId: string; delayMs: number }) {
  const queue = getQueue();
  try {
    await queue.add(
      "publish",
      { scheduledPostId: args.scheduledPostId },
      {
        jobId: args.scheduledPostId,
        delay: Math.max(0, args.delayMs),
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: true,
      }
    );
  } catch (err) {
    // If the job already exists (dedupe), ignore.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("exists")) return;
    throw err;
  }
}

export async function enqueueCommentJob(args: { scheduledPostId: string; delayMs?: number }) {
  const jobId = `comment-${args.scheduledPostId}`;
  const queue = getQueue();
  try {
    await queue.add(
      "comment",
      { scheduledPostId: args.scheduledPostId },
      {
        jobId,
        delay: Math.max(0, args.delayMs ?? 0),
        attempts: 3,
        backoff: { type: "exponential", delay: 1500 },
        removeOnComplete: true,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("exists")) return;
    throw err;
  }
}

export async function enqueueInsightJob(args: { scheduledPostId: string; delayMs?: number }) {
  const jobId = `insight-${args.scheduledPostId}`;
  const queue = getQueue();
  try {
    await queue.add(
      "insight",
      { scheduledPostId: args.scheduledPostId },
      {
        jobId,
        delay: Math.max(0, args.delayMs ?? 0),
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("exists")) return;
    throw err;
  }
}

async function removeJobIfExists(jobId: string) {
  const queue = getQueue();
  const job = await queue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}

export async function removeScheduledPostJobs(scheduledPostId: string) {
  await Promise.all([
    removeJobIfExists(scheduledPostId),
    removeJobIfExists(`comment-${scheduledPostId}`),
    removeJobIfExists(`insight-${scheduledPostId}`),
  ]);
}

export async function ensureInsightsSyncJob() {
  const queue = getQueue();
  try {
    await queue.add(
      "insights-sync",
      {},
      {
        jobId: "insights-sync",
        repeat: { every: 30 * 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("exists")) return;
    throw err;
  }
}

export async function ensureDailyTopicPlannerJob() {
  const queue = getQueue();
  try {
    await queue.add(
      "daily-topic-planner",
      {},
      {
        jobId: "daily-topic-planner",
        repeat: { every: 10 * 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: 100,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("exists")) return;
    throw err;
  }
}

function rssReviewIntervalMs() {
  const raw = Number(optionalEnv("RSS_REVIEW_INTERVAL_MINUTES") ?? "60");
  const minutes = Number.isFinite(raw) ? Math.max(10, Math.min(24 * 60, Math.floor(raw))) : 60;
  return minutes * 60 * 1000;
}

export async function ensureRssReviewHourlyJob() {
  const queue = getQueue();
  const enabledRaw = (optionalEnv("RSS_REVIEW_ENABLED") ?? "1").trim().toLowerCase();
  const enabled = !["0", "false", "off", "no"].includes(enabledRaw);
  if (!enabled) return;

  try {
    await queue.add(
      "rss-review-hourly",
      {},
      {
        jobId: "rss-review-hourly",
        repeat: { every: rssReviewIntervalMs() },
        removeOnComplete: true,
        removeOnFail: 100,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("exists")) return;
    throw err;
  }
}

function postQueueDispatchIntervalMs() {
  const raw = Number(optionalEnv("POST_QUEUE_DISPATCH_INTERVAL_SECONDS") ?? "60");
  const seconds = Number.isFinite(raw) ? Math.max(15, Math.min(60 * 60, Math.floor(raw))) : 60;
  return seconds * 1000;
}

export async function ensurePostQueueDispatchJob() {
  const queue = getQueue();
  const enabledRaw = (optionalEnv("POST_QUEUE_DISPATCH_ENABLED") ?? "1").trim().toLowerCase();
  const enabled = !["0", "false", "off", "no"].includes(enabledRaw);
  if (!enabled) return;

  try {
    await queue.add(
      "post-queue-dispatch",
      {},
      {
        jobId: "post-queue-dispatch",
        repeat: { every: postQueueDispatchIntervalMs() },
        removeOnComplete: true,
        removeOnFail: 100,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("exists")) return;
    throw err;
  }
}

export async function disableDailyTopicPlannerJob() {
  const queue = getQueue();
  const repeatableJobs = await queue.getRepeatableJobs();
  const targets = repeatableJobs.filter((job) => job.name === "daily-topic-planner");

  await Promise.all(targets.map((job) => queue.removeRepeatableByKey(job.key)));
}
