function errorResponse(message, status) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function validKey(key) {
  return typeof key === "string" && /^home-[a-f0-9-]{36}\.(?:jpg|png|webp|gif)$/.test(key);
}

async function ensureMediaTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS homepage_media (
    media_key TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL,
    image_data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return new Uint8Array(value);
  return null;
}

export async function onRequestGet({ params, env }) {
  const key = params?.key;
  if (!validKey(key)) return errorResponse("Image not found.", 404);
  if (!env.DB) return errorResponse("D1 binding DB is not configured.", 500);
  try {
    await ensureMediaTable(env.DB);
    const row = await env.DB.prepare("SELECT content_type, size_bytes, image_data FROM homepage_media WHERE media_key = ?")
      .bind(key).first();
    if (!row) return errorResponse("Image not found.", 404);
    const bytes = toBytes(row.image_data);
    if (!bytes) return errorResponse("Image data is unreadable.", 500);
    const type = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(row.content_type) ? row.content_type : "application/octet-stream";
    return new Response(bytes, { headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff"
    }});
  } catch (error) {
    console.error("Homepage media read error:", error);
    return errorResponse("Could not load image.", 500);
  }
}
