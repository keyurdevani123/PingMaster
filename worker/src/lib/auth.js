/**
 * JWT authentication using Firebase ID Tokens.
 *
 * Firebase signs its ID tokens with RS256 using Google's service account keys.
 * Public keys are available as JWKs at the URL below.
 * We fetch them once per Worker instance and cache them in module scope.
 */

const JWKS_URL =
  "https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com";

let cachedKeys = null; // { keys: CryptoKey[], fetchedAt: number }
const JWKS_TTL_MS = 60 * 60 * 1000; // re-fetch once per hour

/** @returns {Promise<Map<string, CryptoKey>>} kid → CryptoKey */
async function getJwks() {
  const now = Date.now();
  if (cachedKeys && now - cachedKeys.fetchedAt < JWKS_TTL_MS) {
    return cachedKeys.keyMap;
  }

  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error("Failed to fetch Firebase JWKS");

  const { keys } = await res.json();
  const keyMap = new Map();

  for (const jwk of keys) {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keyMap.set(jwk.kid, key);
  }

  cachedKeys = { keyMap, fetchedAt: now };
  return keyMap;
}

/**
 * Decodes a base64url-encoded string to a Uint8Array.
 */
function base64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(padding));
  const uint8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    uint8[i] = binary.charCodeAt(i);
  }
  return uint8;
}

/**
 * Verifies a Firebase ID Token JWT and returns the decoded payload.
 * Throws an Error with a descriptive message on any failure.
 *
 * @param {string} token   - The raw JWT string from the Authorization header
 * @param {string} projectId - Your Firebase project ID (FIREBASE_PROJECT_ID env var)
 * @returns {Promise<object>} - Verified JWT payload (includes .sub = Firebase UID)
 */
export async function verifyFirebaseToken(token, projectId) {
  if (!token || typeof token !== "string") {
    throw new Error("No token provided");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Decode header to get kid
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
  } catch {
    throw new Error("Failed to decode JWT header");
  }

  if (header.alg !== "RS256") {
    throw new Error(`Unexpected JWT algorithm: ${header.alg}`);
  }

  if (!header.kid) {
    throw new Error("JWT header missing kid");
  }

  // 2. Fetch the matching public key
  const keyMap = await getJwks();
  const publicKey = keyMap.get(header.kid);
  if (!publicKey) {
    // Key might have been rotated — bust cache and retry once
    cachedKeys = null;
    const freshKeyMap = await getJwks();
    if (!freshKeyMap.get(header.kid)) {
      throw new Error("Unknown JWT key id");
    }
  }

  const verifyKey = keyMap.get(header.kid) || (await getJwks()).get(header.kid);

  // 3. Verify signature
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlDecode(signatureB64);

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    verifyKey,
    signature,
    signingInput,
  );

  if (!valid) {
    throw new Error("JWT signature verification failed");
  }

  // 4. Decode and validate claims
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  } catch {
    throw new Error("Failed to decode JWT payload");
  }

  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < now) {
    throw new Error("JWT has expired");
  }

  if (payload.iat && payload.iat > now + 60) {
    throw new Error("JWT issued in the future");
  }

  const expectedIss = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIss) {
    throw new Error(`Invalid JWT issuer: ${payload.iss}`);
  }

  if (payload.aud !== projectId) {
    throw new Error(`Invalid JWT audience: ${payload.aud}`);
  }

  if (!payload.sub) {
    throw new Error("JWT missing sub claim");
  }

  return payload;
}

/**
 * Extracts and verifies the Firebase ID Token from the request.
 * Returns the verified auth context on success.
 * Returns null if no token present.
 * Throws an Error with HTTP 401 details on invalid token.
 *
 * @param {Request} request
 * @param {object} env - Worker env (needs FIREBASE_PROJECT_ID)
 * @returns {Promise<{userId: string, email: string, name: string}>}
 */
export async function authenticate(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header", 401);
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new AuthError("Empty bearer token", 401);
  }

  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    // Misconfiguration — fail closed
    throw new AuthError("Server authentication is not configured", 500);
  }

  const payload = await verifyFirebaseToken(token, projectId);
  return {
    userId: payload.sub,
    email: typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "",
    name: typeof payload.name === "string" ? payload.name.trim() : "",
  };
}

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}
