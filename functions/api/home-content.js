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

const DEFAULT_SPONSORS = [
  {
    id: "selkirk",
    name: "Selkirk",
    url: "https://www.selkirk.com/",
    kicker: "Featured brand",
    logo: "SELKIRK",
    headline: "Gear up for your next game.",
    description: "Explore pickleball paddles, footwear, balls and gear.",
    cta: "VISIT SELKIRK",
  },
  {
    id: "reclub",
    name: "Reclub",
    url: "https://reclub.co/clubs/@pbb-pickleball-buddies-qatar-2",
    kicker: "Community platform",
    logo: "Reclub",
    headline: "Find your next game.",
    description: "Join PBB sessions and connect with the community.",
    cta: "JOIN PBB ON RECLUB",
  },
  {
    id: "dupr",
    name: "DUPR",
    url: "https://www.dupr.com/",
    kicker: "Player ratings",
    logo: "DUPR",
    headline: "Track your pickleball progress.",
    description: "Discover player ratings and improve your game.",
    cta: "VISIT DUPR",
  },
];

function validSponsorUrl(value) {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validSponsors(items) {
  return Array.isArray(items) && items.length <= 20 && items.every((item) =>
    item && typeof item === "object" &&
    typeof item.id === "string" && item.id.length > 0 && item.id.length <= 80 &&
    typeof item.name === "string" && item.name.trim().length > 0 && item.name.length <= 80 &&
    validSponsorUrl(item.url) &&
    typeof item.kicker === "string" && item.kicker.length <= 60 &&
    typeof item.logo === "string" && item.logo.trim().length > 0 && item.logo.length <= 50 &&
    typeof item.headline === "string" && item.headline.trim().length > 0 && item.headline.length <= 120 &&
    typeof item.description === "string" && item.description.length <= 220 &&
    typeof item.cta === "string" && item.cta.trim().length > 0 && item.cta.length <= 60 &&
    (item.imageKey == null || validKey(item.imageKey))
  );
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
      !Array.isArray(content.posts) || content.posts.length > 50 ||
      (content.sponsors != null && !validSponsors(content.sponsors))) return false;
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
    const content = state.homepageContent || { heroImages: [], galleryImages: [], posts: [] };
    return json({
      content: { ...content, sponsors: Array.isArray(content.sponsors) ? content.sponsors : DEFAULT_SPONSORS },
      updatedAt: row.updated_at,
    });
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

  // Merge only homepage content into the latest shared state. Sponsor entries
  // are stored here once and consumed by both the homepage and Match Center.
  // A CAS retry
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
    state.homepageContent = {
      heroImages: content.heroImages || [],
      galleryImages: content.galleryImages || [],
      posts: content.posts || [],
      sponsors: content.sponsors || state.homepageContent?.sponsors || DEFAULT_SPONSORS,
    };
    const serializedContent = JSON.stringify(state.homepageContent);
    if (new TextEncoder().encode(serializedContent).byteLength > 80_000) return json({ error: "Homepage content metadata is too large." }, 413);
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
