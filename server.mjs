// Runs Next.js behind a tiny wrapper whose one job is to record who is really
// connecting, for the per-person limits (src/server/client.ts). Browsers can put
// anything in X-Forwarded-For, so the address is taken from the TCP connection,
// skipping only the proxies you say are in front of the app (TRUSTED_PROXIES).
// It's passed on under a header name that's random for each run, so no request
// can forge it.
//   node server.mjs --dev   development (npm run dev)
//   node server.mjs         production, after `next build` (npm start)
// PANEL_MODE=hosted runs it as a public site instead (see src/server/mode.mjs).
import crypto from "node:crypto";
import { createServer } from "node:http";
import next from "next";
import { exitUnlessReady, listenAddress, peerAddress, startupEnv, trustedProxyCount } from "./src/server/mode.mjs";

const dev = process.argv.includes("--dev");
const env = startupEnv(process.cwd(), process.env.NODE_ENV || (dev ? "development" : "production"));
const mode = exitUnlessReady(env);
// Local mode is bound to this computer only by default, so nobody else on your network can
// use your API key, and reads these from the shell as it always has. Hosted mode listens where
// the host says, and also reads them from the .env files.
const settings = mode === "hosted" ? env : process.env;
const { hostname, port } = listenAddress(mode, settings);
const trustedProxies = trustedProxyCount(settings);

const header = `x-panel-peer-${crypto.randomBytes(12).toString("hex")}`;
process.env.PANEL_PEER_HEADER = header;

const server = createServer();
const app = next({ dev, hostname, port, httpServer: server });
const handle = app.getRequestHandler();
await app.prepare();

server.on("request", (req, res) => {
  req.headers[header] = peerAddress(req.headers["x-forwarded-for"], req.socket.remoteAddress, trustedProxies);
  handle(req, res);
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`\nPort ${port} is already in use (is Panel already running in another window?). Stop that, or run on another port: PORT=${port + 1} npm run dev\n`);
  else console.error(e);
  process.exit(1);
});
server.listen(port, hostname, () =>
  console.log(`> Ready on http://${hostname}:${port}${dev ? " (development)" : ""}${mode === "hosted" ? `, hosted at ${env.HOSTED_PUBLIC_URL}` : ""}`),
);
