// `npm run dev`: the website in development, with the built-in local database when DATABASE_URL isn't set.
// Reviews are made inside the website's own process; Ctrl+C stops everything.
import { serve } from "./serve.mjs";

await serve({ dev: true });
