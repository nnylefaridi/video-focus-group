// Runs Next.js behind a tiny wrapper whose one job is to record who is really
// connecting, for the per-person limits (src/server/client.ts). Browsers can put
// anything in X-Forwarded-For, so the address is taken from the TCP connection,
// skipping only the proxies you say are in front of the app (TRUSTED_PROXIES).
// It's passed on under a header name that's random for each run, so no request
// can forge it.
//   node server.mjs --dev   development (npm run dev)
//   node server.mjs         production, after `next build` (npm start)
import crypto from "node:crypto";
import { createServer } from "node:http";
import next from "next";

const dev = process.argv.includes("--dev");
// Bound to this computer only by default, so nobody else on your network can use your API key.
const hostname = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const trustedProxies = Math.max(0, Number(process.env.TRUSTED_PROXIES || 0) || 0);

const header = `x-panel-peer-${crypto.randomBytes(12).toString("hex")}`;
process.env.PANEL_PEER_HEADER = header;

const server = createServer();
const app = next({ dev, hostname, port, httpServer: server });
const handle = app.getRequestHandler();
await app.prepare();

server.on("request", (req, res) => {
  const chain = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  chain.push(req.socket.remoteAddress ?? "unknown");
  req.headers[header] = chain[Math.max(0, chain.length - 1 - trustedProxies)];
  handle(req, res);
});
server.listen(port, hostname, () => console.log(`> Ready on http://${hostname}:${port}${dev ? " (development)" : ""}`));
