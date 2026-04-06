import { generateKeyPairSync, createSign } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

const authModuleUrl = pathToFileURL(path.resolve("src/lib/auth.js")).href;
const auth = await import(authModuleUrl);
const projectId = process.env.FIREBASE_PROJECT_ID || "pingmaster-964f1";
const originalFetch = global.fetch;

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signJwt(privateKey, header, payload) {
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${b64url(signer.sign(privateKey))}`;
}

try {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { format: "jwk" },
    privateKeyEncoding: { format: "pem", type: "pkcs1" },
  });

  publicKey.kid = "local-auth-test-key";
  publicKey.use = "sig";
  publicKey.alg = "RS256";

  global.fetch = async () => ({
    ok: true,
    async json() {
      return { keys: [publicKey] };
    },
  });

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: publicKey.kid };
  const payload = {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    sub: "auth-smoke-user",
    iat: now,
    exp: now + 3600,
  };

  const validToken = signJwt(privateKey, header, payload);
  const verified = await auth.verifyFirebaseToken(validToken, projectId);
  if (verified.sub !== payload.sub) {
    throw new Error("Valid token verification returned unexpected sub");
  }

  const authedUser = await auth.authenticate(
    new Request("http://localhost/test", {
      headers: { Authorization: `Bearer ${validToken}` },
    }),
    { FIREBASE_PROJECT_ID: projectId },
  );
  if (authedUser !== payload.sub) {
    throw new Error("authenticate() returned unexpected user");
  }

  let missingHeaderPassed = false;
  try {
    await auth.authenticate(new Request("http://localhost/test"), { FIREBASE_PROJECT_ID: projectId });
  } catch (err) {
    missingHeaderPassed = err?.status === 401;
  }
  if (!missingHeaderPassed) {
    throw new Error("Missing Authorization header was not rejected with 401");
  }

  let missingProjectPassed = false;
  try {
    await auth.authenticate(
      new Request("http://localhost/test", {
        headers: { Authorization: `Bearer ${validToken}` },
      }),
      {},
    );
  } catch (err) {
    missingProjectPassed = err?.status === 500;
  }
  if (!missingProjectPassed) {
    throw new Error("Missing FIREBASE_PROJECT_ID was not rejected with 500");
  }

  const wrongAudienceToken = signJwt(privateKey, header, { ...payload, aud: "wrong-project" });
  let wrongAudiencePassed = false;
  try {
    await auth.verifyFirebaseToken(wrongAudienceToken, projectId);
  } catch (err) {
    wrongAudiencePassed = String(err?.message || "").includes("Invalid JWT audience");
  }
  if (!wrongAudiencePassed) {
    throw new Error("Wrong audience token was not rejected");
  }

  console.log("Auth smoke test passed");
} finally {
  global.fetch = originalFetch;
}
