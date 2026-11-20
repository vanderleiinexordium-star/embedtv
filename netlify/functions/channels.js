
exports.handler = async function () {
  const upstream = "https://embedtv.cc/api/channels";

  try {
    const response = await fetch(upstream, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const body = await response.text();

    if (!response.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: `API respondeu HTTP ${response.status}`
        })
      };
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "A API não retornou JSON válido."
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 502,
      body: JSON.stringify({
        error: "Falha ao acessar a API.",
        detail: String(error)
      })
    };
  }
};
