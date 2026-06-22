import { prisma } from "@/lib/prisma";
import { decryptString, encryptString } from "@/server/crypto";
import { refreshLongLivedToken } from "@/server/threadsApi";

const REFRESH_SKEW_MS = 10 * 60 * 1000; // refresh if expiring within 10 minutes
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SCHEDULED_REFRESH_THRESHOLD_DAYS = 30;

function accountDisplayName(account: {
  id: string;
  label?: string | null;
  threadsUsername?: string | null;
  threadsUserId?: string | null;
}) {
  return account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id;
}

export async function ensureValidAccessToken(account: {
  id: string;
  accessTokenEncrypted: string;
  proxyUrlEncrypted?: string | null;
  tokenExpiresAt: Date;
}): Promise<{ accessToken: string; proxyUrl?: string }> {
  const current = decryptString(account.accessTokenEncrypted);
  const proxyUrl = account.proxyUrlEncrypted ? decryptString(account.proxyUrlEncrypted) : undefined;
  const now = Date.now();

  if (account.tokenExpiresAt.getTime() - now > REFRESH_SKEW_MS) {
    return { accessToken: current, proxyUrl };
  }

  const refreshed = await refreshLongLivedToken({ accessToken: current, proxyUrl });
  const expiresIn = refreshed.expiresInSeconds ?? 60 * 60 * 24 * 30; // fallback 30d
  const tokenExpiresAt = new Date(now + expiresIn * 1000);

  await prisma.threadsAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encryptString(refreshed.accessToken),
      tokenExpiresAt,
    },
  });

  return { accessToken: refreshed.accessToken, proxyUrl };
}

export type ThreadsTokenRefreshResult = {
  checkedCount: number;
  dueCount: number;
  refreshed: Array<{
    id: string;
    name: string;
    previousExpiresAt: string;
    nextExpiresAt: string;
  }>;
  failed: Array<{
    id: string;
    name: string;
    expiresAt: string;
    error: string;
  }>;
};

export async function refreshDueThreadsAccountTokens(options?: {
  now?: Date;
  thresholdDays?: number;
}): Promise<ThreadsTokenRefreshResult> {
  const now = options?.now ?? new Date();
  const thresholdDays = Math.max(1, Math.floor(options?.thresholdDays ?? DEFAULT_SCHEDULED_REFRESH_THRESHOLD_DAYS));
  const dueBefore = new Date(now.getTime() + thresholdDays * DAY_MS);

  const accounts = await prisma.threadsAccount.findMany({
    where: {
      tokenExpiresAt: {
        lte: dueBefore,
      },
    },
    orderBy: [{ tokenExpiresAt: "asc" }, { updatedAt: "asc" }],
    select: {
      id: true,
      label: true,
      threadsUsername: true,
      threadsUserId: true,
      accessTokenEncrypted: true,
      proxyUrlEncrypted: true,
      tokenExpiresAt: true,
    },
  });

  const result: ThreadsTokenRefreshResult = {
    checkedCount: accounts.length,
    dueCount: accounts.length,
    refreshed: [],
    failed: [],
  };

  for (const account of accounts) {
    const name = accountDisplayName(account);
    const previousExpiresAt = account.tokenExpiresAt;

    try {
      const accessToken = decryptString(account.accessTokenEncrypted);
      const proxyUrl = account.proxyUrlEncrypted ? decryptString(account.proxyUrlEncrypted) : undefined;
      const refreshed = await refreshLongLivedToken({ accessToken, proxyUrl });
      const expiresIn = refreshed.expiresInSeconds ?? 60 * 60 * 24 * 60;
      const nextExpiresAt = new Date(now.getTime() + expiresIn * 1000);

      await prisma.threadsAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEncrypted: encryptString(refreshed.accessToken),
          tokenExpiresAt: nextExpiresAt,
        },
      });

      result.refreshed.push({
        id: account.id,
        name,
        previousExpiresAt: previousExpiresAt.toISOString(),
        nextExpiresAt: nextExpiresAt.toISOString(),
      });
    } catch (err) {
      result.failed.push({
        id: account.id,
        name,
        expiresAt: previousExpiresAt.toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
