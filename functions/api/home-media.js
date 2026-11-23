import { isOrganizerAuthorized } from "../_shared/auth.js";

const MAX_IMAGE_BYTES = 1_700_000; // D1 enforces a 2 MB maximum per BLOB/row.

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function extensionFor(type) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[type] || null;
}

async function matchesImageSignature(file, type) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (type === "image/gif") return String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8");
  if (type === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
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

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD secret is not configured." }, 503);
  if (!(await isOrganizerAuthorized(request, env))) return json({ error: "Organizer access is required." }, 401);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "Upload must use multipart form data." }, 400); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Choose an image to upload." }, 400);
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return json({ error: "Images must be 1.7 MB or smaller after automatic compression." }, 413);
  const extension = extensionFor(file.type);
  if (!extension || !(await matchesImageSignature(file, file.type))) return json({ error: "Use a valid JPEG, PNG, WebP or GIF image." }, 415);

  const key = `home-${crypto.randomUUID()}.${extension}`;
  try {
    await ensureMediaTable(env.DB);
    const imageData = await file.arrayBuffer();
    await env.DB.prepare(`INSERT INTO homepage_media (media_key, content_type, original_name, size_bytes, image_data)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(key, file.type, String(file.name || "image").slice(0, 120), imageData.byteLength, imageData)
      .run();
    return json({ ok: true, key, url: `/media/${key}`, size: imageData.byteLength, contentType: file.type });
  } catch (error) {
    console.error("Homepage media upload error:", error);
    return json({ error: "Could not save the image in the existing D1 database." }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD secret is not configured." }, 503);
  if (!(await isOrganizerAuthorized(request, env))) return json({ error: "Organizer access is required." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  if (!validKey(body?.key)) return json({ error: "The media key is invalid." }, 400);
  try {
    await ensureMediaTable(env.DB);
    await env.DB.prepare("DELETE FROM homepage_media WHERE media_key = ?").bind(body.key).run();
    return json({ ok: true });
  } catch (error) {
    console.error("Homepage media delete error:", error);
    return json({ error: "Could not delete the image from D1." }, 500);
  }
}
