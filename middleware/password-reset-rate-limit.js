import { createHash } from "node:crypto";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_IP = 10;
const MAX_REQUESTS_PER_EMAIL = 3;
const MAX_CONFIRMATIONS_PER_IP = 20;
const buckets = new Map();

function keyDigest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function consume(key, limit, now) {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function pruneExpiredBuckets(now) {
  if (buckets.size <= 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimitPasswordReset(request, response, next) {
  const now = Date.now();
  pruneExpiredBuckets(now);

  const remoteAddress = request.socket.remoteAddress || "unknown";
  const email = typeof request.body?.email === "string"
    ? request.body.email.trim().toLowerCase()
    : "";
  const byIp = consume(`ip:${keyDigest(remoteAddress)}`, MAX_REQUESTS_PER_IP, now);
  const byEmail = consume(
    `email:${keyDigest(email || "invalid")}`,
    MAX_REQUESTS_PER_EMAIL,
    now,
  );
  if (!byIp.allowed || !byEmail.allowed) {
    response.setHeader("Retry-After", String(Math.max(
      byIp.allowed ? 0 : byIp.retryAfterSeconds,
      byEmail.allowed ? 0 : byEmail.retryAfterSeconds,
    )));
    response.status(429).json({ error: "Too many reset requests. Please try again later." });
    return;
  }
  next();
}

export function rateLimitPasswordResetConfirmation(request, response, next) {
  const now = Date.now();
  pruneExpiredBuckets(now);
  const remoteAddress = request.socket.remoteAddress || "unknown";
  const result = consume(
    `confirm-ip:${keyDigest(remoteAddress)}`,
    MAX_CONFIRMATIONS_PER_IP,
    now,
  );
  if (!result.allowed) {
    response.setHeader("Retry-After", String(result.retryAfterSeconds));
    response.status(429).json({ error: "Too many reset attempts. Please try again later." });
    return;
  }
  next();
}
