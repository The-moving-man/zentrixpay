import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { publishers, resources } from "../db/schema.js";
import { generateApiKey, hashApiKey } from "../utils/crypto.js";

export async function registerPublisher(data: {
  name: string;
  email: string;
  walletAddress: string;
}) {
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  const [publisher] = await db
    .insert(publishers)
    .values({
      name: data.name,
      email: data.email,
      walletAddress: data.walletAddress,
      apiKeyHash,
    })
    .returning();

  return { publisher, apiKey };
}

/**
 * Replace a publisher's API key. The new key is returned once; only its hash is
 * stored, so the old key stops authenticating as soon as this commits.
 */
export async function rotatePublisherKey(publisherId: string) {
  const apiKey = generateApiKey();
  const [publisher] = await db
    .update(publishers)
    .set({ apiKeyHash: hashApiKey(apiKey) })
    .where(eq(publishers.id, publisherId))
    .returning();
  return { publisher, apiKey };
}

export async function getPublisherById(id: string) {
  return db
    .select()
    .from(publishers)
    .where(eq(publishers.id, id))
    .then((rows) => rows[0] ?? null);
}

export async function getPublisherResources(publisherId: string) {
  return db.select().from(resources).where(eq(resources.publisherId, publisherId));
}
