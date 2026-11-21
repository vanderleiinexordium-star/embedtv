import { getStore } from "@netlify/blobs";

export const config = { schedule: "17 * * * *" };

export default async () => {
  const store = getStore("playbibostv-playlists");
  const { blobs } = await store.list({ prefix: "jobs/" });
  const now = Date.now();
  for (const item of blobs) {
    const meta = await store.get(item.key, { type: "json" });
    if (meta && Number(meta.expiresAt) <= now) {
      const id = item.key.slice("jobs/".length);
      await store.delete("playlists/" + id);
      await store.delete(item.key);
    }
  }
};
