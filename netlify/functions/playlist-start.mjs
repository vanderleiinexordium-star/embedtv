import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const ALLOWED_HOSTS = new Set(["bluestarbr.com", "overplus.xyz"]);
const MAX_URL_LENGTH = 4096;
const JOB_TTL_MS = 6 * 60 * 60 * 1000;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

function parseProviderUrl(raw) {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) throw new Error("Informe um link M3U válido.");
  let url;
  try { url = new URL(raw); } catch { throw new Error("Informe um link M3U válido."); }
  if (!["http:", "https:"].includes(url.protocol) ||
      !ALLOWED_HOSTS.has(url.hostname.toLowerCase()) ||
      !["", "80", "443"].includes(url.port) ||
      url.pathname !== "/get.php" || url.username || url.password || url.hash) {
    throw new Error("Por segurança, este link precisa ser de um provedor autorizado e usar /get.php.");
  }
  const username = url.searchParams.get("username");
  const password = url.searchParams.get("password");
  if (!username || !password || username.length > 200 || password.length > 200) {
    throw new Error("O link precisa conter usuário e senha da lista.");
  }
  const output = url.searchParams.get("output") === "m3u8" ? "m3u8" : "ts";
  url.search = "";
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  url.searchParams.set("type", "m3u_plus");
  url.searchParams.set("output", output);
  return url.toString();
}

export default async (request) => {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  let input;
  try { input = await request.json(); } catch { return json(400, { error: "Requisição inválida." }); }
  let sourceUrl;
  try { sourceUrl = parseProviderUrl(input.url); } catch (error) { return json(400, { error: error.message }); }

  const id = randomUUID();
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + JOB_TTL_MS;
  const store = getStore("playbibostv-playlists");
  await store.setJSON("jobs/" + id, {
    state: "queued",
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt,
    createdAt: Date.now()
  });

  const workerUrl = new URL("/api/playlist-worker-invoke", request.url);
  let launched;
  try {
    launched = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, sourceUrl })
    });
  } catch {
    await store.setJSON("jobs/" + id, { state: "failed", tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt, error: "Não foi possível iniciar o processamento." });
    return json(502, { error: "Não foi possível iniciar o processamento da lista." });
  }
  if (!launched.ok && launched.status !== 202) {
    await store.setJSON("jobs/" + id, { state: "failed", tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt, error: "Não foi possível iniciar o processamento." });
    return json(502, { error: "A Netlify não iniciou o processamento da lista." });
  }
  return json(202, { id, token, expiresAt });
};
