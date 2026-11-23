import { isOrganizerAuthorized } from "../_shared/auth.js";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function readRow(db) {
  return db.prepare("SELECT state_json, revision, updated_at FROM app_state WHERE id = 1").first();
}

function validKey(key) {
  return typeof key === "string" && /^home-[a-f0-9-]{36}\.(?:jpg|png|webp|gif)$/.test(key);
}

function validMedia(items, max) {
  return Array.isArray(items) && items.length <= max && items.every((item) =>
    item && typeof item === "object" && typeof item.id === "string" && item.id.length <= 80 &&
    validKey(item.key) && typeof item.alt === "string" && item.alt.length <= 180 &&
    typeof item.caption === "string" && item.caption.length <= 120
  );
}

function validateContent(content) {
  if (!content || typeof content !== "object" ||
      !validMedia(content.heroImages || [], 12) ||
      !validMedia(content.galleryImages || [], 24) ||
      !Array.isArray(content.posts) || content.posts.length > 50) return false;
  return content.posts.every((post) => post && typeof post === "object" &&
    typeof post.id === "string" && post.id.length <= 80 &&
    typeof post.title === "string" && post.title.trim().length > 0 && post.title.length <= 100 &&
    typeof post.body === "string" && post.body.length <= 1500 &&
    typeof post.date === "string" && post.date.length <= 40 &&
    (post.imageKey == null || validKey(post.imageKey))
  );
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  try {
    const row = await readRow(env.DB);
    if (!row) return json({ error: "Shared database is not initialized." }, 503);
    const state = JSON.parse(row.state_json);
    return json({ content: state.homepageContent || { heroImages: [], galleryImages: [], posts: [] }, updatedAt: row.updated_at });
  } catch (error) {
    console.error("Homepage content read error:", error);
    return json({ error: "Could not load homepage content." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD secret is not configured." }, 503);
  if (!(await isOrganizerAuthorized(request, env))) return json({ error: "Organizer access is required." }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  const content = body?.content;
  if (!validateContent(content)) return json({ error: "Homepage content is invalid. Check image limits and announcement fields." }, 400);

  const serializedContent = JSON.stringify({ heroImages: content.heroImages || [], galleryImages: content.galleryImages || [], posts: content.posts || [] });
  if (new TextEncoder().encode(serializedContent).byteLength > 80_000) return json({ error: "Homepage content metadata is too large." }, 413);

  // Merge only the homepage content into the latest shared state. A CAS retry
  // prevents a simultaneous Match Center save from being overwritten.
  for (let attempt = 0; attempt < 5; attempt++) {
    let row;
    try { row = await readRow(env.DB); } catch (error) {
      console.error("Homepage content revision read error:", error);
      return json({ error: "Could not read the shared database revision." }, 500);
    }
    if (!row) return json({ error: "Shared database is not initialized." }, 503);
    let state;
    try { state = JSON.parse(row.state_json); } catch { return json({ error: "Shared state is unreadable." }, 500); }
    state.homepageContent = JSON.parse(serializedContent);
    const serialized = JSON.stringify(state);
    if (new TextEncoder().encode(serialized).byteLength > 900_000) return json({ error: "Shared state is too large to save." }, 413);
    try {
      const result = await env.DB.prepare(
        `UPDATE app_state SET state_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND revision = ?`
      ).bind(serialized, row.revision).run();
      if (result.meta.changes === 1) return json({ ok: true, content: state.homepageContent, revision: Number(row.revision) + 1 });
    } catch (error) {
      console.error("Homepage content save error:", error);
      return json({ error: "Could not save homepage content." }, 500);
    }
  }
  return json({ error: "The shared data changed during the save. Please try again." }, 409);
}
