function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function latestState(db) {
  return db
    .prepare("SELECT state_json, revision, updated_at FROM app_state WHERE id = 1")
    .first();
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);

  try {
    const row = await latestState(env.DB);
    if (!row) return json({ error: "D1 is connected, but its migration has not been applied." }, 503);

    return json({
      state: JSON.parse(row.state_json),
      revision: row.revision,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error("D1 read error:", error);
    return json({ error: "Could not read the shared match state." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD secret is not configured. Writes are disabled." }, 503);

  const suppliedPassword = request.headers.get("X-Admin-Password") || "";
  if (suppliedPassword !== env.ADMIN_PASSWORD) {
    const row = await latestState(env.DB);
    return json({
      error: "Organizer password was not accepted.",
      ...(row ? { state: JSON.parse(row.state_json), revision: row.revision } : {}),
    }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const state = body?.state;
  const revision = Number(body?.revision);
  if (
    !state || typeof state !== "object" ||
    !Array.isArray(state.players) || !Array.isArray(state.matches) ||
    !Number.isInteger(state.seq) || state.seq < 1 ||
    !Number.isInteger(revision) || revision < 1
  ) {
    return json({ error: "The submitted match state or revision is invalid." }, 400);
  }

  const serialized = JSON.stringify(state);
  if (new TextEncoder().encode(serialized).byteLength > 900_000) {
    return json({ error: "The session data is too large to save." }, 413);
  }

  try {
    const result = await env.DB.prepare(
      `UPDATE app_state
       SET state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND revision = ?`
    ).bind(serialized, revision).run();

    if (result.meta.changes !== 1) {
      const row = await latestState(env.DB);
      if (!row) return json({ error: "The shared session row is missing. Re-apply the D1 migration." }, 503);
      return json({
        error: "A newer version of the session already exists.",
        state: JSON.parse(row.state_json),
        revision: row.revision,
        updatedAt: row.updated_at,
      }, 409);
    }

    const row = await latestState(env.DB);
    return json({
      ok: true,
      revision: row.revision,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error("D1 write error:", error);
    return json({ error: "Could not save the shared match state." }, 500);
  }
}
