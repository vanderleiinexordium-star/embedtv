
exports.handler = async function () {
  try {
    const username = process.env.IPTV_USERNAME;
    const password = process.env.IPTV_PASSWORD;

    if (!username || !password) {
      throw new Error("Credenciais IPTV não configuradas");
    }

    const url = new URL("https://p2pro.space/get.php");
    url.searchParams.set("username", username);
    url.searchParams.set("password", password);
    url.searchParams.set("type", "m3u_plus");

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error("Falha ao buscar lista IPTV: HTTP " + response.status);
    }

    const playlist = await response.text();

    if (!playlist.trim().startsWith("#EXTM3U")) {
      throw new Error("O servidor não retornou uma lista M3U válida");
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      },
      body: playlist
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      },
      body: "Erro IPTV: " + (error.message || "falha desconhecida")
    };
  }
};
