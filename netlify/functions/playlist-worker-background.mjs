import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const MAX_PLAYLIST_BYTES = 100 * 1024 * 1024;

export const config = { background: true };

export default async (request) => {
  let input;
  try { input = await request.json(); } catch { return; }
  const { id, sourceUrl } = input || {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof sourceUrl !== "string") return;

  const store = getStore("playbibostv-playlists");
  const jobKey = "jobs/" + id;
  const meta = await store.get(jobKey, { type: "json", consistency: "strong" });
  if (!meta || meta.expiresAt < Date.now()) return;

  try {
    await store.setJSON(jobKey, { ...meta, state: "downloading", startedAt: Date.now() });
    const response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/x-mpegURL, audio/x-mpegurl, text/plain, */*", "User-Agent": "PlayBibosTV/1.0" },
      signal: AbortSignal.timeout(12 * 60 * 1000)
    });
    if (response.status >= 300 && response.status < 400) throw new Error("O provedor redirecionou a conexão; por segurança, o redirecionamento foi bloqueado.");
    if (!response.ok) throw new Error("O provedor respondeu HTTP " + response.status + ".");
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_PLAYLIST_BYTES) throw new Error("A lista ultrapassa o limite de 100 MB.");

    const playlist = await response.blob();
    if (playlist.size > MAX_PLAYLIST_BYTES) throw new Error("A lista ultrapassa o limite de 100 MB.");
    const header = (await playlist.slice(0, 8192).text()).replace(/^\uFEFF/, "").trimStart();
    if (!header.startsWith("#EXTM3U")) throw new Error("O provedor não retornou uma playlist M3U válida.");

    await store.set("playlists/" + id, playlist, { metadata: { expiresAt: String(meta.expiresAt), bytes: String(playlist.size) } });
    await store.setJSON(jobKey, { ...meta, state: "complete", bytes: playlist.size, completedAt: Date.now() });
  } catch (error) {
    const safeMessage = error && typeof error.message === "string" ? error.message.slice(0, 180) : "Falha ao buscar a lista no provedor.";
    await store.setJSON(jobKey, { ...meta, state: "failed", error: safeMessage, completedAt: Date.now() });
  }
};
