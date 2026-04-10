import { prisma } from "@/lib/prisma";

const SESSION_COOKIE = "sbusim_uid";

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  };
}

export async function upsertUserById(userId: string) {
  return prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
  });
}

export function userIdFromLoginId(loginId: string) {
  const normalized = loginId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `login:${normalized || "admin"}`;
}

async function movePromptTemplates(fromUserId: string, toUserId: string) {
  const fromTemplates = await prisma.promptTemplate.findMany({
    where: { userId: fromUserId },
    orderBy: { createdAt: "asc" },
  });

  for (const tpl of fromTemplates) {
    let targetName = tpl.name;
    let suffix = 1;
    while (
      await prisma.promptTemplate.findFirst({
        where: { userId: toUserId, name: targetName, NOT: { id: tpl.id } },
        select: { id: true },
      })
    ) {
      const base = tpl.name.slice(0, 70).trim();
      targetName = `${base}-${suffix}`;
      suffix += 1;
    }

    await prisma.promptTemplate.update({
      where: { id: tpl.id },
      data: { userId: toUserId, name: targetName },
    });
  }
}

async function moveAiPromptSettings(fromUserId: string, toUserId: string) {
  const rows = await prisma.aiPromptSetting.findMany({
    where: { userId: fromUserId },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return;

  await prisma.$transaction(
    rows.map((row) =>
      prisma.aiPromptSetting.upsert({
        where: {
          userId_key: {
            userId: toUserId,
            key: row.key,
          },
        },
        update: { value: row.value },
        create: {
          userId: toUserId,
          key: row.key,
          value: row.value,
        },
      })
    )
  );

  await prisma.aiPromptSetting.deleteMany({
    where: { userId: fromUserId },
  });
}

export async function migrateUserScope(fromUserId: string, toUserId: string) {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return;

  await upsertUserById(toUserId);

  const fromAccounts = await prisma.threadsAccount.findMany({
    where: { userId: fromUserId },
  });
  const toAccounts = await prisma.threadsAccount.findMany({
    where: { userId: toUserId },
  });
  const toByThreadsUserId = new Map(
    toAccounts.filter((acc) => acc.threadsUserId).map((acc) => [acc.threadsUserId as string, acc])
  );

  for (const acc of fromAccounts) {
    const dupe = acc.threadsUserId ? toByThreadsUserId.get(acc.threadsUserId) : undefined;
    if (dupe) {
      await prisma.scheduledPost.updateMany({
        where: { threadsAccountId: acc.id },
        data: { threadsAccountId: dupe.id, userId: toUserId },
      });
      await prisma.dailyTopicPlan.updateMany({
        where: { threadsAccountId: acc.id },
        data: { threadsAccountId: dupe.id, userId: toUserId },
      });
      await prisma.threadsAccount.delete({ where: { id: acc.id } });
      continue;
    }

    await prisma.threadsAccount.update({
      where: { id: acc.id },
      data: { userId: toUserId },
    });
    if (acc.threadsUserId) {
      toByThreadsUserId.set(acc.threadsUserId, acc);
    }
  }

  const fromNaverAccounts = await prisma.naverAccount.findMany({
    where: { userId: fromUserId },
  });
  const toNaverAccounts = await prisma.naverAccount.findMany({
    where: { userId: toUserId },
  });
  const toByNaverUserId = new Map(
    toNaverAccounts.filter((acc) => acc.naverUserId).map((acc) => [acc.naverUserId as string, acc])
  );

  for (const acc of fromNaverAccounts) {
    const dupe = acc.naverUserId ? toByNaverUserId.get(acc.naverUserId) : undefined;
    if (dupe) {
      await prisma.naverAccount.delete({ where: { id: acc.id } });
      continue;
    }

    await prisma.naverAccount.update({
      where: { id: acc.id },
      data: { userId: toUserId },
    });
    if (acc.naverUserId) {
      toByNaverUserId.set(acc.naverUserId, acc);
    }
  }

  await prisma.scheduledPost.updateMany({
    where: { userId: fromUserId },
    data: { userId: toUserId },
  });
  await prisma.dailyTopicPlan.updateMany({
    where: { userId: fromUserId },
    data: { userId: toUserId },
  });
  await prisma.cardNewsProject.updateMany({
    where: { userId: fromUserId },
    data: { userId: toUserId },
  });

  await movePromptTemplates(fromUserId, toUserId);
  await moveAiPromptSettings(fromUserId, toUserId);

  await prisma.user.deleteMany({
    where: {
      id: fromUserId,
      threadsAccounts: { none: {} },
      scheduledPosts: { none: {} },
      cardNewsProjects: { none: {} },
      dailyTopicPlans: { none: {} },
      naverAccounts: { none: {} },
      promptTemplates: { none: {} },
      aiPromptSettings: { none: {} },
    },
  });
}

export const session = {
  cookieName: SESSION_COOKIE,
};
