import { isOrganizerAuthorized } from "../_shared/auth.js";

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

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD secret is not configured." }, 503);
  if (!(await isOrganizerAuthorized(request, env))) return json({ error: "Organizer access is required." }, 401);
  if (!env.PBB_MEDIA) return json({ error: "Cloudflare R2 binding PBB_MEDIA is not configured. Create the homepage media bucket and bind it to this Pages project." }, 503);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "Upload must use multipart form data." }, 400); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Choose an image to upload." }, 400);
  if (file.size < 1 || file.size > 10 * 1024 * 1024) return json({ error: "Images must be 10 MB or smaller." }, 413);
  const extension = extensionFor(file.type);
  if (!extension || !(await matchesImageSignature(file, file.type))) return json({ error: "Use a valid JPEG, PNG, WebP or GIF image." }, 415);

  const key = `home-${crypto.randomUUID()}.${extension}`;
  try {
    await env.PBB_MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { originalName: String(file.name || "image").slice(0, 120), uploadedAt: new Date().toISOString() },
    });
    return json({ ok: true, key, url: `/media/${key}`, size: file.size, contentType: file.type });
  } catch (error) {
    console.error("Homepage media upload error:", error);
    return json({ error: "Could not upload image to Cloudflare R2." }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD secret is not configured." }, 503);
  if (!(await isOrganizerAuthorized(request, env))) return json({ error: "Organizer access is required." }, 401);
  if (!env.PBB_MEDIA) return json({ error: "Cloudflare R2 binding PBB_MEDIA is not configured." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  if (!validKey(body?.key)) return json({ error: "The media key is invalid." }, 400);
  try {
    await env.PBB_MEDIA.delete(body.key);
    return json({ ok: true });
  } catch (error) {
    console.error("Homepage media delete error:", error);
    return json({ error: "Could not delete the image from Cloudflare R2." }, 500);
  }
}
