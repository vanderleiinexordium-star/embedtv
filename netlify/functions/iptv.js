exports.handler = async function () {
  try {
    const username = process.env.IPTV_USERNAME;
    const password = process.env.IPTV_PASSWORD;

    if (!username || !password) {
      throw new Error("Credenciais IPTV não configuradas");
    }

    const url = new URL("https://villaalsnsd.top/get.php");
    url.searchParams.set("username", username);
    url.searchParams.set("password", password);
    url.searchParams.set("type", "m3u_plus");

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Falha ao buscar lista IPTV");
    }

    const playlist = await response.text();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: playlist
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: "Não foi possível carregar a lista IPTV."
    };
  }
};
