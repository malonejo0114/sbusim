import { prisma } from "@/lib/prisma";
import { decryptString, encryptString } from "@/server/crypto";
import { refreshLongLivedToken } from "@/server/threadsApi";

const REFRESH_SKEW_MS = 10 * 60 * 1000; // refresh if expiring within 10 minutes

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
