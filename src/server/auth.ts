import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/server/passwordHash";

export const AUTH_COOKIE_NAME = "sbusim_auth";
export const AUTH_LOGIN_ID_COOKIE_NAME = "sbusim_login_id";

type DashboardLoginAccountSeed = {
  loginId: string;
  loginPassword: string;
  canonicalLoginId?: string;
};

export type DashboardLoginAccount = {
  loginId: string;
  canonicalLoginId?: string;
  enabled: boolean;
  passwordHash?: string;
  loginPassword?: string;
  source: "db" | "env";
};

export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  };
}

function parseAccountsFromEnv(raw: string): DashboardLoginAccountSeed[] {
  const text = raw.trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as Array<{
        loginId?: string;
        loginPassword?: string;
        canonicalLoginId?: string;
      }>;
      return parsed
        .map((item) => ({
          loginId: (item.loginId ?? "").trim(),
          loginPassword: item.loginPassword ?? "",
          canonicalLoginId: (item.canonicalLoginId ?? "").trim() || undefined,
        }))
        .filter((item) => item.loginId.length > 0 && item.loginPassword.length > 0);
    } catch {
      throw new Error("Invalid DASHBOARD_LOGIN_ACCOUNTS format. Use JSON array or 'id:pw,id2:pw2'.");
    }
  }

  return text
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const sep = chunk.indexOf(":");
      if (sep <= 0) {
        throw new Error("Invalid DASHBOARD_LOGIN_ACCOUNTS format. Each item must be 'loginId:password'.");
      }
      const loginId = chunk.slice(0, sep).trim();
      const loginPassword = chunk.slice(sep + 1);
      if (!loginId || !loginPassword) {
        throw new Error("Invalid DASHBOARD_LOGIN_ACCOUNTS format. Empty loginId/password is not allowed.");
      }
      return { loginId, loginPassword };
    });
}

function getDashboardLoginSeedsFromEnv(): DashboardLoginAccountSeed[] {
  const primaryLoginId = (process.env.DASHBOARD_LOGIN_ID ?? "admin").trim() || "admin";
  const primaryLoginPassword = process.env.DASHBOARD_LOGIN_PASSWORD;
  const extra = process.env.DASHBOARD_LOGIN_ACCOUNTS ? parseAccountsFromEnv(process.env.DASHBOARD_LOGIN_ACCOUNTS) : [];

  const byId = new Map<string, DashboardLoginAccountSeed>();
  if (primaryLoginPassword) {
    byId.set(primaryLoginId, { loginId: primaryLoginId, loginPassword: primaryLoginPassword });
  }
  for (const account of extra) {
    byId.set(account.loginId, account);
  }

  const accounts = [...byId.values()];
  if (accounts.length === 0) {
    throw new Error("Missing dashboard login config. Set dashboard login accounts in DB or env.");
  }
  return accounts;
}

function mapDbAccount(row: {
  loginId: string;
  passwordHash: string;
  canonicalLoginId: string | null;
  enabled: boolean;
}): DashboardLoginAccount {
  return {
    loginId: row.loginId,
    canonicalLoginId: row.canonicalLoginId ?? undefined,
    enabled: row.enabled,
    passwordHash: row.passwordHash,
    source: "db",
  };
}

function mapEnvAccount(seed: DashboardLoginAccountSeed): DashboardLoginAccount {
  return {
    loginId: seed.loginId,
    canonicalLoginId: seed.canonicalLoginId,
    enabled: true,
    loginPassword: seed.loginPassword,
    source: "env",
  };
}

function isMissingDashboardLoginTableError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

export function getCanonicalLoginIdForAccount(account: Pick<DashboardLoginAccount, "loginId" | "canonicalLoginId">) {
  return (account.canonicalLoginId ?? account.loginId).trim() || "admin";
}

export async function verifyDashboardLoginPassword(account: DashboardLoginAccount, password: string) {
  if (account.passwordHash) {
    return verifyPassword(password, account.passwordHash);
  }
  return password === (account.loginPassword ?? "");
}

export async function syncDashboardLoginAccountsFromEnv() {
  const seeds = getDashboardLoginSeedsFromEnv();

  for (const seed of seeds) {
    await prisma.dashboardLoginAccount.upsert({
      where: { loginId: seed.loginId },
      update: {},
      create: {
        loginId: seed.loginId,
        passwordHash: hashPassword(seed.loginPassword),
        canonicalLoginId: seed.canonicalLoginId,
        enabled: true,
      },
    });
  }

  const rows = await prisma.dashboardLoginAccount.findMany({
    where: { enabled: true },
    orderBy: [{ createdAt: "asc" }, { loginId: "asc" }],
  });
  return rows.map(mapDbAccount);
}

export async function getDashboardLoginAccounts(): Promise<DashboardLoginAccount[]> {
  try {
    const rows = await prisma.dashboardLoginAccount.findMany({
      where: { enabled: true },
      orderBy: [{ createdAt: "asc" }, { loginId: "asc" }],
    });
    if (rows.length > 0) return rows.map(mapDbAccount);

    return syncDashboardLoginAccountsFromEnv();
  } catch (error) {
    if (isMissingDashboardLoginTableError(error)) {
      return getDashboardLoginSeedsFromEnv().map(mapEnvAccount);
    }
    throw error;
  }
}

export async function getDashboardLoginConfig() {
  const [first] = await getDashboardLoginAccounts();
  return first;
}

export async function isAuthenticated() {
  const store = await cookies();
  return Boolean(store.get(AUTH_COOKIE_NAME)?.value);
}
