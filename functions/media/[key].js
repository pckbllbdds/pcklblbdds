function errorResponse(message, status) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function validKey(key) {
  return typeof key === "string" && /^home-[a-f0-9-]{36}\.(?:jpg|png|webp|gif)$/.test(key);
}

export async function onRequestGet({ params, env }) {
  const key = params?.key;
  if (!validKey(key)) return errorResponse("Image not found.", 404);
  if (!env.PBB_MEDIA) return errorResponse("Homepage media storage is not configured.", 503);
  try {
    const object = await env.PBB_MEDIA.get(key);
    if (!object) return errorResponse("Image not found.", 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(object.body, { headers });
  } catch (error) {
    console.error("Homepage media read error:", error);
    return errorResponse("Could not load image.", 500);
  }
}
