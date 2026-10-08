import { createHash, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const COOKIE_NAME = "cw_guest";
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function db() {
  if (!process.env.DATABASE_URL) throw new ApiError(503, "Database not configured");
  return neon(process.env.DATABASE_URL);
}
export function jsonBody(req) {
  if (typeof req.body === "object" && req.body !== null) return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { throw new ApiError(400, "Invalid JSON body"); }
  }
  return {};
}
export function randomToken() { return randomBytes(32).toString("hex"); }
export function tokenHash(token) { return createHash("sha256").update(token).digest("hex"); }
export function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function guestToken(req) {
  const pair = String(req.headers.cookie || "").split(";").map(s => s.trim())
    .find(s => s.startsWith(COOKIE_NAME + "="));
  const token = pair?.slice(COOKIE_NAME.length + 1) || "";
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export async function currentGuest(req, sql, optional = false) {
  const token = guestToken(req);
  if (!token) { if (optional) return null; throw new ApiError(401, "Start a guest session first"); }
  const rows = await sql`UPDATE crosswave.guests
    SET last_seen_at = now()
    WHERE token_hash = ${tokenHash(token)} AND expires_at > now()
      AND (banned_until IS NULL OR banned_until <= now())
    RETURNING id`;
  if (!rows.length) { if (optional) return null; throw new ApiError(401, "Guest session expired or unavailable"); }
  return rows[0].id;
}
export function api(methods, action) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (!methods.includes(req.method)) {
        res.setHeader("Allow", methods.join(", "));
        throw new ApiError(405, "Method not allowed");
      }
      if (req.method !== "GET") {
        const origin = req.headers.origin;
        if (origin) {
          let host;
          try { host = new URL(origin).host; }
          catch { throw new ApiError(403, "Invalid origin"); }
          if (host !== req.headers.host) throw new ApiError(403, "Invalid origin");
        }
      }
      return await action(req, res);
    } catch (error) {
      if (!(error instanceof ApiError)) console.error("Crosswave API error", error);
      return res.status(error instanceof ApiError ? error.status : 500).json({
        error: error instanceof ApiError ? error.message : "Internal server error"
      });
    }
  };
}
