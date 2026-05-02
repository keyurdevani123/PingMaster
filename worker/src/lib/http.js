function parseAllowedOrigins(env) {
  return new Set(
    [
      env?.FRONTEND_APP_URL || "",
      env?.ALLOWED_ORIGINS || "",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]
      .flatMap((value) => String(value || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function createCorsHeaders(request, env) {
  const origin = typeof request?.headers?.get === "function" ? request.headers.get("Origin") || "" : "";
  const allowedOrigins = parseAllowedOrigins(env);
  const allowOrigin = origin && allowedOrigins.has(origin) ? origin : "";

  const headers = {
    Vary: "Origin, Access-Control-Request-Headers",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Workspace-Id",
    "Access-Control-Max-Age": "86400",
  };

  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }

  return headers;
}

export function json(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}
