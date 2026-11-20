export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) {
    return Response.json({ error: "ADMIN_PASSWORD secret is not configured." }, { status: 503 });
  }

  const suppliedPassword = request.headers.get("X-Admin-Password") || "";
  if (suppliedPassword !== env.ADMIN_PASSWORD) {
    return Response.json({ error: "Incorrect organizer password." }, { status: 401 });
  }

  return Response.json({ ok: true }, {
    headers: { "Cache-Control": "no-store" },
  });
}
