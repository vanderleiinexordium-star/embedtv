import { getStore } from "@netlify/blobs";

const MAX_PLAYLIST_BYTES = 100 * 1024 * 1024;
const VOD_CATEGORY = /(?:^|[\s._|/-])(?:filmes?|movies?|cinema|vod|s[ée]ries?|series|temporadas?|seasons?|epis[óo]dios?|episodes?)(?:$|[\s._|/-])/i;
const VOD_PATH = /(?:^|\/)(?:movie|movies|series|vod)(?:\/|$)/i;
const VOD_TYPE = /(?:^|[\s,;])(?:tvg-)?type=["']?(?:movie|series|vod)(?:["';,\s]|$)/i;
const VOD_EXTENSION = /\.(?:mp4|mkv|avi|mov|wmv|flv|m4v)$/i;

export const config = { background: true };

function isVodEntry(extinf, streamUrl) {
  const group = (extinf.match(/\bgroup-title="([^"]*)"/i) || [])[1] || "";
  if (VOD_CATEGORY.test(group) || VOD_TYPE.test(extinf)) return true;
  try {
    const parsed = new URL(streamUrl);
    if (VOD_PATH.test(parsed.pathname)) return true;
  } catch {}
  return false;
}

export default async (request) => {
  let input;
  try { input = await request.json(); } catch { return; }
  const { id, sourceUrl } = input || {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof sourceUrl !== "string") return;

  let safeUrl;
  try {
    safeUrl = new URL(sourceUrl);
    if (!["http:", "https:"].includes(safeUrl.protocol) ||
        !new Set(["bluestarbr.com", "overplus.xyz"]).has(safeUrl.hostname.toLowerCase()) ||
        !["", "80", "443"].includes(safeUrl.port) ||
        safeUrl.pathname !== "/get.php" || safeUrl.username || safeUrl.password || safeUrl.hash) return;
  } catch { return; }

  const store = getStore("playbibostv-playlists");
  const jobKey = "jobs/" + id;
  const meta = await store.get(jobKey, { type: "json", consistency: "strong" });
  if (!meta || meta.expiresAt < Date.now()) return;

  try {
    await store.setJSON(jobKey, { ...meta, state: "downloading", startedAt: Date.now() });
    const response = await fetch(safeUrl.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/x-mpegURL, audio/x-mpegurl, text/plain, */*", "User-Agent": "PlayBibosTV/1.0" },
      signal: AbortSignal.timeout(12 * 60 * 1000)
    });
    if (response.status >= 300 && response.status < 400) throw new Error("O provedor redirecionou a conexão; por segurança, o redirecionamento foi bloqueado.");
    if (!response.ok) throw new Error("O provedor respondeu HTTP " + response.status + ".");
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_PLAYLIST_BYTES) throw new Error("A lista original ultrapassa o limite de 100 MB.");
    if (!response.body) throw new Error("O provedor não enviou o conteúdo da lista.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const encoder = new TextEncoder();
    const outputParts = [];
    let outputBatch = "";
    let pending = "";
    let entryLines = null;
    let headerProbe = "";
    let sourceBytes = 0;
    let outputBytes = 0;
    let keptCount = 0;
    let removedCount = 0;

    const appendOutput = (value) => {
      if (!value) return;
      outputBatch += value;
      if (outputBatch.length >= 256 * 1024) {
        outputParts.push(outputBatch);
        outputBytes += encoder.encode(outputBatch).byteLength;
        outputBatch = "";
      }
    };

    const consumeLine = (raw) => {
      const line = raw.replace(/\\r$/, "");
      if (!line) {
        if (entryLines) entryLines.push("");
        else appendOutput("\\n");
        return;
      }
      if (line.startsWith("#EXTINF:")) {
        entryLines = [line];
        return;
      }
      if (entryLines) {
        if (line.startsWith("#")) {
          entryLines.push(line);
          return;
        }
        if (/^https?:\\/\\//i.test(line)) {
          const extinf = entryLines[0] || "";
          if (isVodEntry(extinf, line)) {
            removedCount++;
          } else {
            entryLines.push(line);
            appendOutput(entryLines.join("\\n") + "\\n");
            keptCount++;
          }
        }
        entryLines = null;
        return;
      }
      appendOutput(line + "\\n");
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sourceBytes += value.byteLength;
      if (sourceBytes > MAX_PLAYLIST_BYTES) throw new Error("A lista original ultrapassa o limite de 100 MB.");
      const decoded = decoder.decode(value, { stream: true });
      if (headerProbe.length < 8192) headerProbe += decoded.slice(0, 8192 - headerProbe.length);
      pending += decoded;
      let newline;
      while ((newline = pending.indexOf("\\n")) !== -1) {
        consumeLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    }
    pending += decoder.decode();
    if (pending) consumeLine(pending);
    if (!headerProbe.replace(/^\\uFEFF/, "").trimStart().startsWith("#EXTM3U")) {
      throw new Error("O provedor não retornou uma playlist M3U válida.");
    }
    if (keptCount === 0) throw new Error("Não encontrei canais ao vivo nessa lista. Nenhuma alteração foi aplicada.");
    if (outputBatch) {
      outputParts.push(outputBatch);
      outputBytes += encoder.encode(outputBatch).byteLength;
    }
    const filteredPlaylist = new Blob(outputParts, { type: "audio/x-mpegurl; charset=utf-8" });
    if (filteredPlaylist.size > MAX_PLAYLIST_BYTES) throw new Error("A lista reduzida ultrapassou o limite de 100 MB.");

    await store.set("playlists/" + id, filteredPlaylist, {
      metadata: {
        expiresAt: String(meta.expiresAt),
        bytes: String(filteredPlaylist.size),
        sourceBytes: String(sourceBytes),
        liveChannels: String(keptCount),
        removedVodEntries: String(removedCount)
      }
    });
    await store.setJSON(jobKey, {
      ...meta,
      state: "complete",
      bytes: filteredPlaylist.size,
      sourceBytes,
      liveChannels: keptCount,
      removedVodEntries: removedCount,
      completedAt: Date.now()
    });
  } catch (error) {
    const safeMessage = error && typeof error.message === "string" ? error.message.slice(0, 180) : "Falha ao buscar a lista no provedor.";
    await store.setJSON(jobKey, { ...meta, state: "failed", error: safeMessage, completedAt: Date.now() });
  }
};
