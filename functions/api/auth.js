import {
  clearSessionCookie,
  createSessionCookie,
  createSessionToken,
  hasOrganizerSession,
} from "../_shared/auth.js";

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

export async function onRequestGet({ request, env }) {
  return json({ authenticated: await hasOrganizerSession(request, env) });
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: "ADMIN_PASSWORD secret is not configured." }, 503);
  }

  const suppliedPassword = request.headers.get("X-Admin-Password") || "";
  if (suppliedPassword !== env.ADMIN_PASSWORD) {
    return json({ error: "Incorrect organizer password." }, 401);
  }

  const token = await createSessionToken(env.ADMIN_PASSWORD);

  return json({ ok: true }, 200, { "Set-Cookie": createSessionCookie(token) });
}

export async function onRequestDelete() {
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}
