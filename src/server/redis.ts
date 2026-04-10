import IORedis from "ioredis";
import { requireEnv } from "@/server/env";

const globalForRedis = globalThis as unknown as { sbusimRedis?: IORedis };

export function getRedisConnection() {
  if (globalForRedis.sbusimRedis) return globalForRedis.sbusimRedis;

  const url = requireEnv("REDIS_URL");
  const conn = new IORedis(url, {
    maxRetriesPerRequest: null,
  });

  globalForRedis.sbusimRedis = conn;
  return conn;
}

