import { prisma } from "@/lib/prisma";
import { getCanonicalLoginIdForAccount, getDashboardLoginConfig } from "@/server/auth";
import { userIdFromLoginId } from "@/server/session";
import { ensureValidAccessToken } from "@/server/threadsToken";
import { createContainer, publishContainer } from "@/server/threadsApi";

function mediaTypeFromUrl(mediaUrl?: string) {
  if (!mediaUrl) return "TEXT" as const;
  const lower = mediaUrl.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.includes("video")) return "VIDEO" as const;
  return "IMAGE" as const;
}

async function fallbackUserIdFromAuthConfig() {
  const account = await getDashboardLoginConfig();
  return userIdFromLoginId(getCanonicalLoginIdForAccount(account));
}

export async function getDefaultThreadsAccount(options?: { userId?: string }) {
  const userId = options?.userId?.trim() || (await fallbackUserIdFromAuthConfig());

  const account = await prisma.threadsAccount.findFirst({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }],
  });

  return account;
}

export async function getPostingThreadsAccount(options?: {
  userId?: string;
  threadsAccountId?: string;
}) {
  const userId = options?.userId?.trim() || undefined;
  const threadsAccountId = options?.threadsAccountId?.trim() || undefined;

  if (threadsAccountId) {
    const account = await prisma.threadsAccount.findFirst({
      where: {
        id: threadsAccountId,
        ...(userId ? { userId } : {}),
      },
    });
    return account;
  }

  return getDefaultThreadsAccount({ userId });
}

export async function isThreadsPostingAvailable(options?: {
  userId?: string;
  threadsAccountId?: string;
}) {
  const account = await getPostingThreadsAccount(options);
  return Boolean(account);
}

export async function publishToThreads(args: {
  text: string;
  mediaUrl?: string | null;
  replyToId?: string;
  userId?: string;
  threadsAccountId?: string;
}) {
  const account = await getPostingThreadsAccount({
    userId: args.userId,
    threadsAccountId: args.threadsAccountId,
  });
  if (!account) {
    return {
      posted: false as const,
      skipped: true as const,
      reason: args.threadsAccountId
        ? "Selected Threads account is not connected or not accessible."
        : "No connected Threads account for default dashboard user",
    };
  }

  const { accessToken, proxyUrl } = await ensureValidAccessToken(account);
  const mediaType = mediaTypeFromUrl(args.mediaUrl ?? undefined);

  const container = await createContainer({
    accessToken,
    mediaType,
    text: args.text,
    imageUrl: mediaType === "IMAGE" ? args.mediaUrl ?? undefined : undefined,
    videoUrl: mediaType === "VIDEO" ? args.mediaUrl ?? undefined : undefined,
    replyToId: args.replyToId,
    proxyUrl,
  });

  const published = await publishContainer({
    accessToken,
    creationId: container.creationId,
    proxyUrl,
  });

  return {
    posted: true as const,
    skipped: false as const,
    postId: published.id,
  };
}
