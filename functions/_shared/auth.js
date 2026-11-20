const COOKIE_NAME = "pbb_organizer_session";
const SESSION_LABEL = "picklebuddies-qatar-organizer-session-v1";
const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createSessionToken(password) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(SESSION_LABEL));
  return toBase64Url(new Uint8Array(signature));
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function hasOrganizerSession(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const supplied = readCookie(request, COOKIE_NAME);
  if (!supplied) return false;
  const expected = await createSessionToken(env.ADMIN_PASSWORD);
  return constantTimeEqual(supplied, expected);
}

export function createSessionCookie(token) {
  // Persistent on this browser for one year, and inaccessible to page JavaScript.
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function isOrganizerAuthorized(request, env) {
  const suppliedPassword = request.headers.get("X-Admin-Password") || "";
  if (env.ADMIN_PASSWORD && suppliedPassword && suppliedPassword === env.ADMIN_PASSWORD) return true;
  return hasOrganizerSession(request, env);
}
