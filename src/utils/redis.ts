import { redisClient } from "../component";

export async function deleteKeysWithPattern(pattern: string) {
  // Find all keys matching the pattern (e.g., 'user:*')
  const keys = await redisClient.keys(pattern);

  if (keys.length > 0) {
    // Delete all matching keys
    await redisClient.del(keys);
    console.log(`Deleted ${keys.length} keys.`);
  } else {
    console.log("No matching keys found.");
  }
}

export const handleDeleteCache = async (options: {
  userId?: string;
  asset: string;
  assetId?: string;
}) => {
  if (options.assetId) {
    await redisClient.del(`${options.asset}-detail-${options.assetId}`);
    await redisClient.del(`public-${options.asset}-detail-${options.assetId}`);
  }
  if (options.userId) {
    const assetPlural =
      options.asset === "story" ? "stories" : `${options.asset}s`;
    await Promise.all([
      deleteKeysWithPattern(`*${assetPlural}-${options.userId}`),
      deleteKeysWithPattern(`*assets-${options.userId}`),
    ]);
  }
};

export const getCache = async (cacheName: string) => {
  const cachedResult = await redisClient.get(cacheName);
  if (cachedResult) {
    return JSON.parse(cachedResult);
  }
  return null;
};

export const setCache = async (
  cacheName: string,
  result: any,
  expiry: number = 60 * 30 // 30 minutes expiry by default
) => {
  await redisClient.set(cacheName, JSON.stringify(result), {
    EX: expiry,
  });
};
