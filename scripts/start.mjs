// `npm run build`, then `npm start`: the production website on your computer, with the built-in
// local database when DATABASE_URL isn't set. In hosted mode (PANEL_MODE=hosted) it checks the
// settings first and listens where the host says (the Docker image runs the standalone server.js instead).
import { serve } from "./serve.mjs";

await serve({ dev: false });
