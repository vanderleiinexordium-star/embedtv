export default async (request: Request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST." }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  try {
    const target = new URL("/.netlify/functions/playlist-worker-background", request.url);
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text()
    });
    if (response.status !== 202) {
      const detail = (await response.text().catch(() => "")).slice(0, 180);
      return new Response(JSON.stringify({ error: "A invocação da função retornou HTTP " + response.status + ". " + detail }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
    return new Response(null, { status: 202 });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 180) : "Falha desconhecida";
    return new Response(JSON.stringify({ error: "A Edge Function não conseguiu chamar o processamento: " + detail }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
};
