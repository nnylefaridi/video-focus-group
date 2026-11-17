# Hosting Video Focus Group (Render + Supabase + Stripe)

Local mode needs none of this. This page is for running the public, paid site. Nothing here has been deployed yet: the config files (`render.yaml`, `Dockerfile`, `.dockerignore`, and `fly.toml` for the second choice of host) are ready, and every step below is for you to do.

How it fits together:

- **The visitor's browser prepares the video.** It makes a 720p MP4 (the short side at most 720 px), a poster, stills at the moments the server asks for, sprite sheets for close looks later, loudness and silence, and a word-timed transcript (Whisper base, in a Web Worker). It sends those files straight to private Supabase Storage over one-time signed URLs, then sends a manifest describing them. The speech model (about 79 MB, once per browser) comes from Hugging Face's CDN and its runtime (about 14–28 MB) from jsDelivr, not from your server.
- **One process on the server.** Next.js's standalone `server.js` serves the site and, inside the same process, runs the reviews (`src/server/runner.ts`). It checks every file the browser sent (exact set, sizes, MP4 header, every JPEG decoded) before anything paid runs, then makes the Claude calls. There is no ffmpeg, no speech model and no separate worker.
- **Reviews survive restarts.** Each review is a job in Postgres with a lease. A server that restarts or wakes from sleep picks unfinished reviews up again on boot and whenever someone opens a review or the health check is called. Work already paid for (perception batches) is kept in the review's draft and not repeated.
- **Supabase** holds sign-in, the Postgres database and the private `review-media` bucket.
- **Stripe** takes prepaid top-ups ($10 / $25 / $50). Credits pay for reviews (see `billing.md`); people can instead save their own Anthropic key.
- **Database migrations run by themselves**, once, the first time the website connects (`src/server/db.ts`). There's nothing to run by hand.

## What the server needs (measured)

| | |
| --- | --- |
| **Memory** | Measured on the standalone `server.js` (Node 22, macOS arm64, local mode against the Supabase dev database), sampled every 0.5 s while a real 8-second 1080×1920 video went through the browser, the upload, the server's checks and the evidence step: **about 148 MB after start, 240 MB at the peak, about 226 MB after**. Hosted mode (`next start` against the Supabase dev project, after its first page loads, before any upload): **about 184 MB** for the server process (plus about 54 MB for the `npm start` wrapper, which the Docker image doesn't run; it starts `server.js` directly). The Claude steps (perception, reviewers, discussion, synthesis) weren't measured, because they're paid; they mostly wait on the network, and the largest thing they hold is up to ~25 stills of at most 300 KB each. A 512 MB instance is enough; the Dockerfile caps Node's heap at 320 MB (`NODE_OPTIONS=--max-old-space-size=320`) so it can't grow into the limit. |
| **CPU** | Light: the heavy work is in the browser. On the server, checking a review's files is a few hundred milliseconds of `sharp` decoding; the rest is waiting on Claude. 0.1 CPU is slow to start (cold start about a minute on Render) but enough to run. |
| **Long requests / background work** | Yes. After the upload, a review runs in the background inside the process for several minutes (an estimate of up to ~20 minutes; the full paid run wasn't measured). A follow-up answer streams for up to a minute or two in one request. Nothing needs a request longer than that. |
| **Can it sleep?** | Yes, safely. The review page polls every few seconds while a review runs, which keeps a free Render instance awake. If everyone closes the tab, Render sleeps the instance after 15 minutes; the review pauses and resumes when anyone next opens the site. A follow-up answer cut off by a restart is marked "didn't get an answer" after 15 minutes, and its credit is settled. |
| **Disk** | No persistent disk. `/tmp/panel-data` is scratch space for the files of the review being worked on, fetched from Supabase as needed; it can be wiped at any restart. |
| **Bandwidth** | Small. The site's pages and scripts only; video and stills go browser → Supabase and Supabase → browser over signed URLs, and the speech model and runtime come from public CDNs. (The build also contains a 26 MB copy of the runtime's wasm file that the app doesn't request.) Supabase's own egress (playback of the 720p video) counts against Supabase's plan, not Render's. |

## Render (first choice): free web service

Render's free web service: 512 MB RAM, 0.1 CPU, no persistent disk, may restart at any time, sleeps after 15 minutes without visits (about a minute to wake), 750 instance-hours and 5 GB outbound bandwidth a month. Requests can run up to 100 minutes. All of that fits, per the table above.

1. Push the branch you want to run to GitHub and make it the repo's default branch (the Blueprint deploys the default branch).
2. Render → **New → Blueprint** → pick the repo. Render reads `render.yaml`: one free Docker web service, health check `/api/health`, with `PANEL_MODE=hosted`, `PORT=8080`, `CLIENT_IP_HEADER=CF-Connecting-IP` and `MAX_UPLOAD_MB=50` already set.
3. Render asks for each value marked `sync: false`. Fill in:
   - `HOSTED_PUBLIC_URL`: the service's address, `https://<name>.onrender.com` (shown once the service exists; set it, then redeploy), or your own domain.
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: public. Render passes every environment variable to the Docker build as a build argument; the Dockerfile declares only these two, so only they are built into the pages.
   - `SUPABASE_SECRET_KEY`, `DATABASE_URL` (Session pooler), `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
   - `KEY_ENCRYPTION_SECRET` and `MEDIA_SECRET`: each from `openssl rand -base64 32`. Keep copies somewhere safe.
   - Optionally `OWNER_EMAILS`, `DAILY_LIMIT_USD`, `MONTHLY_LIMIT_USD` (Environment tab).
4. Apply. The first build takes a few minutes. Watch the logs for `Ready`, then open `https://<name>.onrender.com/api/health`: `{"ok":true}`.
5. In Supabase, set the Site URL and Redirect URLs to `HOSTED_PUBLIC_URL` (below). In Stripe, add the webhook endpoint (below).
6. **Check the client address header once.** Render serves sites through Cloudflare, which sets `CF-Connecting-IP` to the visitor's address and won't let a visitor supply their own; Render keeps whatever `X-Forwarded-For` a visitor sends, so that one isn't safe. Per-person and per-network limits use this address. After the first deploy, start a review from two different networks (say, phone data and Wi-Fi) and check they count separately. If `CF-Connecting-IP` were ever missing, every visitor would share one limit (the site would still work, just with tighter limits).
7. Custom domain: Render → the service → Settings → Custom Domains → add it and follow the DNS records shown. Then set `HOSTED_PUBLIC_URL` and the Supabase Site URL to it.

Free-plan notes: the first visit after a quiet spell waits about a minute while the instance wakes. Reviews already running keep the instance awake through the review page's polling. 750 hours a month is enough for one always-awake instance.

## Fly.io (second choice)

`fly.toml` runs the same image on one `shared-cpu-1x` machine with 512 MB, kept on (`auto_stop_machines = "off"`), health-checked at `/api/health`, with `CLIENT_IP_HEADER=Fly-Client-IP`. Needs the Fly CLI, logged in (`fly auth login`). From the repo root:

```bash
fly launch --no-deploy --copy-config --name video-focus-group --region yyz
fly secrets set \
  HOSTED_PUBLIC_URL=https://example.com \
  NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
  SUPABASE_SECRET_KEY=... DATABASE_URL=... \
  KEY_ENCRYPTION_SECRET="$(openssl rand -base64 32)" \
  MEDIA_SECRET="$(openssl rand -base64 32)" \
  STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... \
  ANTHROPIC_API_KEY=... OWNER_EMAILS=you@example.com MAX_UPLOAD_MB=50
fly deploy \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
fly certs add example.com     # then add the DNS records it prints
curl https://example.com/api/health      # {"ok":true}
```

## Environment variables

"Hosted" = required when `PANEL_MODE=hosted`. The site refuses to start and names whatever is missing.

| Name | Hosted? | What it is | Where to get it | Example format |
| --- | --- | --- | --- | --- |
| `PANEL_MODE` | yes | Switches on hosted mode. Set by `render.yaml` / `fly.toml` / the Dockerfile. | — | `hosted` |
| `HOSTED_PUBLIC_URL` | yes | The site's public https address, nothing after it. | Render service URL or your domain | `https://video-focus-group.onrender.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL. Also a **build argument** (built into the pages). Public. | Supabase → Project Settings → API | `https://abcd1234.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase publishable key. Also a **build argument**. Public by design. | Supabase → Project Settings → API Keys | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | yes | Supabase secret key (server only). | Supabase → Project Settings → API Keys | `sb_secret_…` |
| `DATABASE_URL` | yes | Postgres connection string. | Supabase → Connect → **Session pooler** (port 5432) | `postgresql://postgres.abcd1234:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres` |
| `KEY_ENCRYPTION_SECRET` | yes | Encrypts people's saved Anthropic keys. If lost or changed, they must save theirs again. | `openssl rand -base64 32` | 44 characters ending in `=` |
| `MEDIA_SECRET` | yes | Keys the per-network limits (and signs local-mode media links). Keep it the same across restarts. | `openssl rand -base64 32` | 44 characters ending in `=` |
| `STRIPE_SECRET_KEY` | yes | Creates Checkout Sessions. | Stripe → Developers → API keys | `sk_live_…` (or `sk_test_…`, or a restricted `rk_…` with Checkout Sessions write) |
| `STRIPE_WEBHOOK_SECRET` | yes | Verifies Stripe's webhook calls. | Stripe → Developers → Webhooks → your endpoint → Signing secret | `whsec_…` |
| `ANTHROPIC_API_KEY` | yes, in practice | The server's key, used only for work paid with credits (reviews, follow-ups and answer checks of signed-in accounts with a balance). Visitors who haven't chosen how to pay never use it. Without it, credit work stops with a clear message. | console.anthropic.com → Settings → API Keys | `sk-ant-…` |
| `CLIENT_IP_HEADER` | yes (this or `TRUSTED_PROXIES`) | Header the host overwrites with the visitor's address. | Set by `render.yaml` (`CF-Connecting-IP`) / `fly.toml` (`Fly-Client-IP`) | |
| `TRUSTED_PROXIES` | see above | Number of proxies in front that each append to X-Forwarded-For. Not used on Render. | — | `1` |
| `MAX_UPLOAD_MB` | no | Biggest prepared video in MB. Default 50 in hosted mode (Supabase Free's per-file cap), 250 locally. | You | `50` |
| `OWNER_EMAILS` | no, but set it | Your login email(s): you see the app's API spend on Your reviews. | You | `you@example.com` |
| `HOSTNAME`, `PORT` | no | Where `server.js` listens. Set by the Dockerfile (`0.0.0.0`, `8080`) and `render.yaml`. | — | |
| `NEXT_PUBLIC_MODEL_HOST`, `NEXT_PUBLIC_ORT_WASM_BASE` | no | Where browsers get the speech model and its runtime (defaults: Hugging Face and jsDelivr). Built into the pages: to change them, add them as `ARG`s to the Dockerfile's build stage. | You | |
| `FOLLOWUP_COST_CAP_USD`, `REVIEW_COST_CAP_USD` | no | Most one follow-up answer / one review may cost (defaults 1.5 and 3). | You | |
| `DAILY_LIMIT_USD`, `MONTHLY_LIMIT_USD` | no | App-wide spending ceilings on the server key for spend nobody prepaid (defaults 10 and 40). Calls paid with prepaid credits and calls on people's own keys don't count toward them. If Anthropic refuses the server key (out of credit, or 401), the logs show an `[ALERT]` line and credits pause for 10 minutes: no top-ups and no new credit-paid reviews, and nobody is charged for the failed review. | You | `50`, `500` |
| `MAX_REVIEWS_PER_DAY`, `MAX_FOLLOWUPS_PER_REVIEW`, `MAX_ANSWER_CHECKS_PER_HOUR`, `MAX_REVIEWS_PER_NETWORK_PER_DAY`, `MAX_ANSWER_CHECKS_PER_NETWORK_PER_HOUR`, `MAX_KEY_CHECKS_PER_HOUR` | no | Per-person and per-network limits. Defaults are in `.env.example`. | You | `8` |
| `DATA_DIR` | no | Scratch folder. Set by the Dockerfile (`/tmp/panel-data`). | — | |

## Supabase setup

1. Create a project at supabase.com (pick a region near your Render (or Fly) region). Save the database password.
2. **Keys and URL:** Project Settings → API / API Keys. Copy the project URL, the publishable key and the secret key.
3. **Database URL:** Connect → copy the connection string, put the password in. Render and Fly connect over IPv4, so use the **Session pooler** string unless you've bought the IPv4 add-on.
4. **Authentication → Sign In / Providers:** the login page offers **Email** (with password) and **Google**. Leave Email on. For Google, create an OAuth client in Google Cloud Console (type: Web application) and paste its client ID and secret into Supabase's Google provider; add Supabase's callback URL shown there as an authorized redirect URI in Google.
5. **Authentication → URL Configuration:** set **Site URL** to your `HOSTED_PUBLIC_URL` (for example `https://example.com`) and add `https://example.com/**` under **Redirect URLs**. Open the site at that address only.
6. **Storage:** nothing to make by hand. Migration `0001_init.sql` creates the private `review-media` bucket (MP4, JPEG and VTT only, 50 MB per file). The browser sends its prepared 720p copy, poster, frames and sprite sheets there over one-time signed URLs; the website never handles the video bytes. (`review-uploads`, from 0008, is no longer used and stays empty.)
7. **Migrations:** applied automatically on first start (see above). After the first deploy, check Table Editor → schema `app` has tables.

## Stripe setup

1. Make a Stripe account and finish business verification (needed for live payments).
2. **Test mode first.** Developers → API keys → copy the test secret key (`sk_test_…`).
3. Local webhook testing with the Stripe CLI (against a hosted-mode copy running on your own computer, never the production site):
   ```
   stripe login
   stripe listen --forward-to localhost:3000/api/stripe/webhook   # prints a whsec_… to use as STRIPE_WEBHOOK_SECRET
   stripe trigger checkout.session.completed                     # optional; a real test top-up with card 4242 4242 4242 4242 is the better check
   ```
4. **Live mode:** switch the Dashboard to live, copy the live secret key, then Developers → Webhooks → Add endpoint:
   - URL: `<HOSTED_PUBLIC_URL>/api/stripe/webhook`. On Render's free plan the site may be asleep: Stripe retries a webhook for up to three days, so a top-up made while it slept lands once it wakes.
   - Events (exactly these four):
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `charge.refunded`
     - `charge.dispute.created`
   - Copy the endpoint's signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
5. Packs are $10 / $25 / $50; $10 is the minimum, and the 20% margin covers Stripe's fee even then (`billing.md`).

## Monthly cost estimate

Check before buying, as of Nov 2026. Prices change; confirm each on its own pricing page.

| Item | Cost | Notes |
| --- | --- | --- |
| Render free web service | $0 | Sleeps after 15 minutes idle; about a minute to wake. Render's paid Starter instance (no sleeping) is about $7/mo if you outgrow it |
| Fly (second choice), shared-cpu-1x 512 MB, always on | about $3–4/mo | |
| Supabase **Free** | $0 | Pauses after a week of inactivity, 50 MB per file, 1 GB storage. Fine for testing, risky for a paid site |
| Supabase **Pro** | $25/mo | Recommended for launch: no pausing, more storage and egress |
| Domain | about $10–20/year | Optional on Render (the onrender.com address works) |
| Stripe | 2.9% + 30¢ per top-up (more for international cards) | A $10 top-up costs 59¢; it comes out of the 20% margin |
| Anthropic | Pay-as-you-go | Covered by what people spend in credits, or they use their own key |
| **Total fixed** | **$0 on Render Free + Supabase Free; about $25/mo with Supabase Pro** | Plus Anthropic spend that credits repay with a 20% margin |

## Pre-launch checklist

- [ ] You've read and approved the privacy policy and terms (`/privacy`, `/terms` are drafts; `legal-review.md` lists what to check).
- [ ] Stripe **test mode** end to end: top-up with card `4242 4242 4242 4242`, see the credit land, run a review, check a refund (`charge.refunded`) takes it back.
- [ ] Set a **hard spending limit** on the server's key in the Anthropic Console (Settings → Limits). The app's own limits are the first line, this is the last one.
- [ ] `OWNER_EMAILS` is set to your login email.
- [ ] `DAILY_LIMIT_USD` / `MONTHLY_LIMIT_USD` raised to what you're willing to pay Anthropic.
- [ ] Supabase Site URL and Redirect URLs match `HOSTED_PUBLIC_URL`; Google sign-in works.
- [ ] Switch Stripe to live keys and webhook; do one real $10 top-up yourself.
- [ ] `https://<your domain>/api/health` returns `{"ok":true}`, and the first screen is only the first question.
- [ ] Upload a short real video as a signed-in account, on a phone and on a laptop, and confirm the review finishes.
- [ ] On Render: check the client address header (below) once, with two different networks.
- [ ] `MAX_UPLOAD_MB` is 50 (Supabase Free's per-file cap; the 720p copy of a 3-minute video is well under it).
