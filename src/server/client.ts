import crypto from "node:crypto";
import { MEDIA_SECRET } from "./config";

/**
 * Who is calling, for per-person limits: the visitor's IP address, so every tab,
 * window and browser on one connection shares one allowance.
 *
 * The address is the one server.mjs read from the connection itself (under a
 * header name that's random per run, so a request can't supply its own), or, when
 * CLIENT_IP_HEADER is set, a header your host overwrites on every request (e.g.
 * cf-connecting-ip on Cloudflare, fly-client-ip on Fly). Without either, everyone
 * shares one allowance rather than anyone getting around it.
 * IPv6 addresses are grouped by their /64 network, since one household or phone
 * usually gets a whole /64. Only a keyed hash is stored, never the address.
 */
export function clientIp(headers: Headers): string {
  const name = process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || process.env.PANEL_PEER_HEADER;
  const raw = name ? headers.get(name)?.split(",")[0] : null;
  return normalizeIp(raw?.trim() || "unknown");
}

export function normalizeIp(ip: string): string {
  let a = ip.toLowerCase();
  const bracketed = a.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) a = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(a)) a = a.replace(/:\d+$/, "");
  a = a.replace(/%.*$/, "");
  const mapped = a.match(/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  if (!a.includes(":")) return a;
  // Expand "::" and keep the first four groups (the /64 network).
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = a.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = a.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return a;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

export function clientKey(headers: Headers): string {
  return crypto.createHmac("sha256", MEDIA_SECRET).update(`ip:${clientIp(headers)}`).digest("base64url").slice(0, 32);
}

/**
 * Whose allowance a request uses. Signed in: the account's own, so people sharing a
 * school or office network don't share one allowance. Signed out: the network's.
 * Every use also counts toward the network's overall ceiling.
 */
export type Who = { person: string; network: string; signedIn: boolean };

export function whoIsCalling(headers: Headers, userId: string | null): Who {
  const network = clientKey(headers);
  return userId ? { person: `user:${userId}`, network, signedIn: true } : { person: network, network, signedIn: false };
}
