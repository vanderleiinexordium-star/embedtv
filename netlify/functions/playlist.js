const MAX_PLAYLIST_BYTES = 15 * 1024 * 1024;
const ALLOWED_HOST = 'bluestarbr.com';

function json(statusCode, body, contentType = 'application/json; charset=utf-8') {
  return { statusCode, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, JSON.stringify({ error: 'Use POST.' }));
  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return json(400, JSON.stringify({ error: 'Requisição inválida.' })); }

  let url;
  try { url = new URL(String(input.url || '')); } catch { return json(400, JSON.stringify({ error: 'Informe um link M3U válido.' })); }

  if (!['http:', 'https:'].includes(url.protocol) ||
      url.hostname.toLowerCase() !== ALLOWED_HOST ||
      !['', '80', '443'].includes(url.port) ||
      url.pathname !== '/get.php' ||
      url.username || url.password || url.hash) {
    return json(400, JSON.stringify({ error: 'Por segurança, este link precisa ser do endereço de lista autorizado e usar /get.php.' }));
  }

  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');
  if (!username || !password || username.length > 200 || password.length > 200) {
    return json(400, JSON.stringify({ error: 'O link precisa conter usuário e senha da lista.' }));
  }
  url.search = '';
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);
  url.searchParams.set('type', 'm3u_plus');
  url.searchParams.set('output', 'ts');

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'application/x-mpegURL, audio/x-mpegurl, text/plain, */*', 'User-Agent': 'PlayBibosTV/1.0' },
      signal: AbortSignal.timeout(25000)
    });
    if (response.status >= 300 && response.status < 400) return json(502, JSON.stringify({ error: 'O servidor da lista redirecionou a conexão. O redirecionamento foi bloqueado por segurança.' }));
    if (!response.ok) return json(502, JSON.stringify({ error: 'O provedor respondeu HTTP ' + response.status + '.' }));
    const reader = response.body && response.body.getReader();
    if (!reader) return json(502, JSON.stringify({ error: 'Não foi possível ler a lista recebida.' }), 'text/plain; charset=utf-8');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PLAYLIST_BYTES) {
        await reader.cancel();
        return json(413, JSON.stringify({ error: 'A lista ultrapassa o limite de 15 MB.' }));
      }
      chunks.push(Buffer.from(value));
    }
    const playlist = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
    if (!playlist.trimStart().startsWith('#EXTM3U')) return json(502, JSON.stringify({ error: 'O provedor não retornou uma playlist M3U válida.' }));
    return json(200, playlist, 'application/vnd.apple.mpegurl; charset=utf-8');
  } catch (error) {
    const code = error && error.cause && error.cause.code ? error.cause.code : (error && error.name) || 'NETWORK';
    return json(502, JSON.stringify({ error: 'Falha ao buscar a lista no provedor (' + code + ').' }));
  }
};
