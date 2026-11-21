const crypto = require('node:crypto');

const PLAYLIST_URL = 'https://p2pro.space/get.php';
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 100;

// Reutiliza o catÃ¡logo em memÃ³ria enquanto a mesma instÃ¢ncia da Function estiver ativa.
let cachedChannels = null;
let cachedAt = 0;
let pendingLoad = null;

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(data)
  };
}

function attribute(info, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = info.match(new RegExp('(?:^|\\s)' + escaped + '="([^"]*)"', 'i'));
  return match ? match[1].trim() : '';
}

function parsePlaylist(playlist) {
  const lines = playlist.replace(/^\uFEFF/, '').split(/\r?\n/);
  const channels = [];
  let entry = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(',');
      const info = comma >= 0 ? line.slice(0, comma) : line;
      const listedName = comma >= 0 ? line.slice(comma + 1).trim() : '';
      entry = {
        name: listedName || attribute(info, 'tvg-name') || 'Canal sem nome',
        logo: attribute(info, 'tvg-logo'),
        category: attribute(info, 'group-title') || 'Outros'
      };
      continue;
    }

    if (line.startsWith('#')) continue;

    if (entry && /^https?:\/\//i.test(line)) {
      const id = crypto.createHash('sha1').update(line + '\n' + entry.name).digest('hex').slice(0, 16);
      channels.push({ id, name: entry.name, logo: entry.logo, category: entry.category, url: line });
    }
    entry = null;
  }

  return channels;
}

async function getChannels() {
  if (cachedChannels && Date.now() - cachedAt < CACHE_TTL_MS) return cachedChannels;
  if (pendingLoad) return pendingLoad;

  pendingLoad = (async () => {
    const username = process.env.IPTV_USERNAME;
    const password = process.env.IPTV_PASSWORD;
    if (!username || !password) throw new Error('Configure IPTV_USERNAME e IPTV_PASSWORD nas variÃ¡veis do Netlify.');

    const url = new URL(PLAYLIST_URL);
    url.searchParams.set('username', username);
    url.searchParams.set('password', password);
    url.searchParams.set('type', 'm3u_plus');

    const response = await fetch(url.toString(), { headers: { Accept: 'application/x-mpegURL, audio/x-mpegurl, text/plain, */*' } });
    if (!response.ok) throw new Error('O provedor IPTV respondeu HTTP ' + response.status + '.');

    const playlist = await response.text();
    if (!playlist.trimStart().replace(/^\uFEFF/, '').startsWith('#EXTM3U')) {
      throw new Error('O provedor nÃ£o retornou uma playlist M3U vÃ¡lida. Verifique o endereÃ§o e as credenciais.');
    }

    const parsed = parsePlaylist(playlist);
    if (!parsed.length) throw new Error('A playlist foi recebida, mas nenhum canal vÃ¡lido foi encontrado.');

    cachedChannels = parsed;
    cachedAt = Date.now();
    return cachedChannels;
  })();

  try {
    return await pendingLoad;
  } finally {
    pendingLoad = null;
  }
}

exports.handler = async function (event) {
  try {
    const params = event.queryStringParameters || {};
    const action = params.action || 'channels';
    const channels = await getChannels();

    if (action === 'categories') {
      const names = [...new Set(channels.map(channel => channel.category))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      return json(200, { categories: names.map(name => ({ name })), total: names.length });
    }

    if (action !== 'channels') return json(400, { error: 'AÃ§Ã£o invÃ¡lida. Use categories ou channels.' });

    const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
    const requestedLimit = parseInt(params.limit || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
    const limit = Math.min(MAX_LIMIT, Math.max(1, requestedLimit));
    const query = String(params.q || '').trim().toLocaleLowerCase('pt-BR');
    const category = String(params.category || '').trim();
    const favoriteIds = params.favorites ? new Set(params.favorites.split(',').filter(Boolean)) : null;

    let filtered = channels;
    if (category) filtered = filtered.filter(channel => channel.category === category);
    if (favoriteIds) filtered = filtered.filter(channel => favoriteIds.has(channel.id));
    if (query) filtered = filtered.filter(channel => (channel.name + ' ' + channel.category).toLocaleLowerCase('pt-BR').includes(query));

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    return json(200, { channels: filtered.slice(start, start + limit), page, limit, total, totalPages });
  } catch (error) {
    return json(500, { error: error.message || 'Falha ao carregar a playlist IPTV.' });
  }
};
