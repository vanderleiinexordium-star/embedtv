import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const CHUNK_BYTES = 2 * 1024 * 1024;
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function authorized(meta, token) {
  if (!meta || typeof token !== "string" || token.length !== 64) return false;
  const expected = Buffer.from(meta.tokenHash || "", "hex");
  const actual = Buffer.from(createHash("sha256").update(token).digest("hex"), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export default async (request) => {
  if (request.method !== "GET") return json(405, { error: "Use GET." });
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\\s+/i, "");
  const offset = Number(url.searchParams.get("offset"));
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(offset) || offset < 0) return json(400, { error: "Solicitação inválida." });
  const store = getStore("playbibostv-playlists");
  const meta = await store.get("jobs/" + id, { type: "json", consistency: "strong" });
  if (!authorized(meta, token)) return json(404, { error: "Lista não encontrada ou acesso expirado." });
  if (meta.expiresAt < Date.now()) return json(410, { error: "Esta lista temporária expirou." });
  if (meta.state !== "complete") return json(409, { error: "A lista ainda não está pronta." });
  if (offset >= meta.bytes) return json(416, { error: "Fim da lista." });

  const playlist = await store.get("playlists/" + id, { type: "blob", consistency: "strong" });
  if (!playlist) return json(404, { error: "O arquivo temporário não foi encontrado." });
  const end = Math.min(offset + CHUNK_BYTES, playlist.size);
  const part = playlist.slice(offset, end);
  return new Response(part, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(end - offset),
      "X-Playlist-Total": String(meta.bytes),
      "X-Playlist-Offset": String(offset),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
};
