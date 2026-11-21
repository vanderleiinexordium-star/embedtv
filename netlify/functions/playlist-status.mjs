import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

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
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Solicitação inválida." });
  const store = getStore("playbibostv-playlists");
  const meta = await store.get("jobs/" + id, { type: "json", consistency: "strong" });
  if (!authorized(meta, token)) return json(404, { error: "Lista não encontrada ou acesso expirado." });
  if (meta.expiresAt < Date.now()) return json(410, { error: "Esta lista temporária expirou. Carregue novamente." });
  return json(200, { state: meta.state, bytes: meta.bytes || 0, error: meta.error || null, expiresAt: meta.expiresAt });
};
