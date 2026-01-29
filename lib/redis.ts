import Redis from "ioredis";

let redisClient: Redis | null = null;
let redisAvailable = false;

export function getRedisClient(): Redis | null {
  if (redisClient) {
    return redisAvailable ? redisClient : null;
  }

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true
  });

  // Suppress unhandled error events
  redisClient.on("error", () => {
    redisAvailable = false;
  });

  redisClient.on("ready", () => {
    redisAvailable = true;
  });

  redisClient.on("close", () => {
    redisAvailable = false;
  });

  redisClient.connect().catch(() => {
    redisAvailable = false;
  });

  return null; // Return null until connection is ready
}

export function isRedisReady(): boolean {
  return redisAvailable && redisClient !== null && redisClient.status === "ready";
}

export async function safeRedisGet(key: string): Promise<string | null> {
  if (!isRedisReady() || !redisClient) {
    return null;
  }
  try {
    return await redisClient.get(key);
  } catch {
    return null;
  }
}

export async function safeRedisSet(key: string, value: string): Promise<boolean> {
  if (!isRedisReady() || !redisClient) {
    return false;
  }
  try {
    await redisClient.set(key, value);
    return true;
  } catch {
    return false;
  }
}

export async function safeRedisDel(key: string): Promise<boolean> {
  if (!isRedisReady() || !redisClient) {
    return false;
  }
  try {
    await redisClient.del(key);
    return true;
  } catch {
    return false;
  }
}

export function getRedisDocumentKey(documentId: string) {
  return `doc:${documentId}:state`;
}
