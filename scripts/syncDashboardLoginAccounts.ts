import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { syncDashboardLoginAccountsFromEnv } from "@/server/auth";

async function main() {
  const accounts = await syncDashboardLoginAccountsFromEnv();
  console.log(`dashboard login accounts ready: ${accounts.map((account) => account.loginId).join(", ")}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
