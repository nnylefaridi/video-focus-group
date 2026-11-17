# Hosting Video Focus Group (Fly.io + Supabase + Stripe)

Local mode needs none of this. This page is for running the public, paid site. Nothing here has been deployed yet; the config files (`Dockerfile`, `fly.toml`, `.dockerignore`) are ready, and every command below is for you to run.

How it fits together:

- **One image, two processes.** `app` is the website (`node server.mjs`, public). `worker` (`node --import tsx worker/index.mts`, no public address) turns uploaded videos into reviews. The image has ffmpeg and a pinned whisper.cpp build with the `ggml-base.en.bin` model, checked against its checksum at build time.
- **Supabase** holds sign-in, the Postgres database and the private `review-uploads` storage bucket.
- **Stripe** takes prepaid top-ups ($10 / $25 / $50). Credits pay for reviews (see `billing.md`); people can instead save their own Anthropic key.
- **Database migrations run by themselves**, once, the first time the website or worker connects (`src/server/db.ts`). There's nothing to run by hand.

## Environment variables

"Hosted" = required when `PANEL_MODE=hosted`. The site and worker refuse to start and name whatever is missing.

| Name | Hosted? | What it is | Where to get it | Example format |
| --- | --- | --- | --- | --- |
| `PANEL_MODE` | yes | Switches on hosted mode. Set by `fly.toml`. | You | `hosted` |
| `HOSTED_PUBLIC_URL` | yes | The site's public https address, nothing after it. | Your domain | `https://example.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL. Also a **build argument** (built into the pages). Public. | Supabase → Project Settings → API | `https://abcd1234.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase publishable key. Also a **build argument**. Public by design. | Supabase → Project Settings → API Keys | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | yes | Supabase secret key (server only). | Supabase → Project Settings → API Keys | `sb_secret_…` |
| `DATABASE_URL` | yes | Postgres connection string. | Supabase → Connect → Connection string. Use the **Session pooler** (port 5432) or the direct connection | `postgresql://postgres.abcd1234:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres` |
| `KEY_ENCRYPTION_SECRET` | yes | Encrypts people's saved Anthropic keys. If lost or changed, they must save theirs again. | `openssl rand -base64 32` | 44 characters ending in `=` |
| `MEDIA_SECRET` | yes | Signs links to review media and keys the per-network limits. Same on every machine, so links work across machines and restarts. Keep it; changing it breaks existing links and resets those limits once. | `openssl rand -base64 32` | 44 characters ending in `=` (32+ bytes, base64 or hex) |
| `STRIPE_SECRET_KEY` | yes | Creates Checkout Sessions. | Stripe → Developers → API keys | `sk_live_…` (or `sk_test_…`, or a restricted `rk_…` with Checkout Sessions write) |
| `STRIPE_WEBHOOK_SECRET` | yes | Verifies Stripe's webhook calls. | Stripe → Developers → Webhooks → your endpoint → Signing secret (test mode: printed by `stripe listen`) | `whsec_…` |
| `ANTHROPIC_API_KEY` | yes, in practice | The server's key, used for reviews paid with credits. Without it, credit reviews stop with a clear message. | console.anthropic.com → Settings → API Keys | `sk-ant-…` |
| `CLIENT_IP_HEADER` | yes (this or `TRUSTED_PROXIES`) | Header the host overwrites with the visitor's address. Set by `fly.toml`. | — | `Fly-Client-IP` |
| `TRUSTED_PROXIES` | see above | Number of proxies in front. Set by `fly.toml`. | — | `1` |
| `OWNER_EMAILS` | no, but set it | Your login email(s): you see the app's API spend on Your reviews. | You | `you@example.com` |
| `HOST`, `PORT` | no | Set by `fly.toml` and the Dockerfile. `PORT` must equal `internal_port`. | — | `0.0.0.0`, `8080` |
| `MAX_UPLOAD_MB` | no | Biggest video in MB (default 250). Supabase Free caps files at 50 MB, so either raise Storage → Settings → Global file size limit (paid plan) or set `50`. | You | `50` |
| `FOLLOWUP_COST_CAP_USD` | no | Most one follow-up answer may cost (default 1.5). | You | `1.5` |
| `REVIEW_COST_CAP_USD` | no | Most one review may cost (default 3). | You | `3` |
| `DAILY_LIMIT_USD`, `MONTHLY_LIMIT_USD` | no | App-wide spending ceilings on the server key (defaults 10 and 40). **Raise these for a public site**, or one busy day stops everyone. | You | `50`, `500` |
| `MAX_REVIEWS_PER_DAY`, `MAX_FOLLOWUPS_PER_REVIEW`, `MAX_ANSWER_CHECKS_PER_HOUR`, `MAX_REVIEWS_PER_NETWORK_PER_DAY`, `MAX_ANSWER_CHECKS_PER_NETWORK_PER_HOUR`, `MAX_KEY_CHECKS_PER_HOUR` | no | Per-person and per-network limits. Defaults are in `.env.example`. | You | `8` |
| `DATA_DIR`, `WHISPER_MODEL`, `WHISPER_BIN` | no | Set by the Dockerfile (`/tmp/panel-data`, `/opt/models/ggml-base.en.bin`, `/usr/local/bin/whisper-cli`). | — | — |

Already in `fly.toml` (not secret): `PANEL_MODE`, `HOST`, `PORT`, `CLIENT_IP_HEADER`, `TRUSTED_PROXIES`.

### Secrets to set with `fly secrets set`

Names only; put your own values after each `=`.

```
HOSTED_PUBLIC_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
DATABASE_URL
KEY_ENCRYPTION_SECRET
MEDIA_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
ANTHROPIC_API_KEY
OWNER_EMAILS
```

Optionally also `MAX_UPLOAD_MB`, `DAILY_LIMIT_USD`, `MONTHLY_LIMIT_USD`. Fly secrets are shared by `app` and `worker`. The two `NEXT_PUBLIC_` values are needed at runtime *and* as build arguments.

## Supabase setup

1. Create a project at supabase.com (pick a region near your Fly region). Save the database password.
2. **Keys and URL:** Project Settings → API / API Keys. Copy the project URL, the publishable key and the secret key.
3. **Database URL:** Connect → copy the connection string, put the password in. Fly machines connect over IPv4, so use the **Session pooler** string unless you've bought the IPv4 add-on.
4. **Authentication → Sign In / Providers:** the login page offers **Email** (with password) and **Google**. Leave Email on. For Google, create an OAuth client in Google Cloud Console (type: Web application) and paste its client ID and secret into Supabase's Google provider; add Supabase's callback URL shown there as an authorized redirect URI in Google.
5. **Authentication → URL Configuration:** set **Site URL** to your `HOSTED_PUBLIC_URL` (for example `https://example.com`) and add `https://example.com/**` under **Redirect URLs**. Open the site at that address only.
6. **Storage:** nothing to make by hand. Migration `0008_review_uploads_bucket.sql` creates the private `review-uploads` bucket. If you want videos over 50 MB, raise Storage → Settings → Global file size limit (Pro plan) and set `MAX_UPLOAD_MB` to match.
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
   - URL: `<HOSTED_PUBLIC_URL>/api/stripe/webhook`
   - Events (exactly these four):
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `charge.refunded`
     - `charge.dispute.created`
   - Copy the endpoint's signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
5. Packs are $10 / $25 / $50; $10 is the minimum, and the 20% margin covers Stripe's fee even then (`billing.md`).

## Domain

1. Buy a domain from any registrar (Cloudflare Registrar, Namecheap, Porkbun).
2. `fly certs add example.com` (and `www.example.com` if you want it). Fly prints the DNS records to add (an `A`/`AAAA` pair, or a `CNAME`). Add them at your registrar.
3. `fly certs show example.com` until it says the certificate is issued.
4. Set `HOSTED_PUBLIC_URL` to `https://example.com` and make the same address the Supabase Site URL.

## Launch: exact command sequence

Needs the Fly CLI (`flyctl`), logged in (`fly auth login`). Run from the repo root.

```bash
# 1. Make the Fly app (don't deploy yet). If the name in fly.toml is taken, pick another.
fly launch --no-deploy --copy-config --name video-focus-group --region yyz

# 2. Secrets (use your own values; generate the encryption secret with openssl)
fly secrets set \
  HOSTED_PUBLIC_URL=https://example.com \
  NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
  SUPABASE_SECRET_KEY=... DATABASE_URL=... \
  KEY_ENCRYPTION_SECRET="$(openssl rand -base64 32)" \
  MEDIA_SECRET="$(openssl rand -base64 32)" \
  STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... \
  ANTHROPIC_API_KEY=... OWNER_EMAILS=you@example.com

# 3. Deploy (builds whisper.cpp, so the first build takes several minutes)
fly deploy \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...

# 4. One machine of each: the website, and the worker that must always be on
fly scale count app=1 worker=1

# 5. Domain
fly certs add example.com

# 6. Watch it start (the worker logs "[worker] ready"; the app logs "> Ready on http://0.0.0.0:8080")
fly logs
curl https://example.com/api/health      # {"ok":true}
```

`fly secrets set` restarts the machines, so set secrets before the first deploy. The Fly name `app` in `fly scale count app=1` is the process group, not the Fly app name.

A note on disk: machines use temporary disk (`/tmp/panel-data`). Videos live in Supabase Storage, and the media-link secret comes from `MEDIA_SECRET`, so it's the same on every machine and across restarts.

## Monthly cost estimate

Check before buying, as of Nov 2026. Prices change; confirm each on its own pricing page.

| Item | Cost | Notes |
| --- | --- | --- |
| Fly `app` VM (shared-cpu-1x, 1 GB) | about $5–6/mo if always on; less with auto-stop | Stops when idle and wakes on a visit (a few seconds' delay) |
| Fly `worker` VM (shared-cpu-2x, 2 GB) | about $11–12/mo | Always on, so it picks up uploads |
| Fly bandwidth, certificates | about $0–2 | Video goes straight to Supabase, not through Fly |
| Supabase **Free** | $0 | Pauses after a week of inactivity, 50 MB per file, 1 GB storage. Fine for testing, risky for a paid site |
| Supabase **Pro** | $25/mo | Recommended for launch: no pausing, bigger files and storage |
| Domain | about $10–20/year (about $1–2/mo) | |
| Stripe | 2.9% + 30¢ per top-up (more for international cards) | $10 top-up costs 59¢; it comes out of the 20% margin |
| Anthropic | Pay-as-you-go | Covered by what people spend in credits, or they use their own key |
| **Total fixed** | **about $18–22/mo on Supabase Free, about $43–47/mo on Pro** | Plus Anthropic spend that credits repay with a 20% margin |

## Pre-launch checklist

- [ ] You've read and approved the privacy policy and terms (`/privacy`, `/terms` are drafts; `legal-review.md` lists what to check).
- [ ] Stripe **test mode** end to end: top-up with card `4242 4242 4242 4242`, see the credit land, run a review, check a refund (`charge.refunded`) takes it back.
- [ ] Set a **hard spending limit** on the server's key in the Anthropic Console (Settings → Limits). The app's own limits are the first line, this is the last one.
- [ ] `OWNER_EMAILS` is set to your login email.
- [ ] `DAILY_LIMIT_USD` / `MONTHLY_LIMIT_USD` raised to what you're willing to pay Anthropic.
- [ ] Supabase Site URL and Redirect URLs match `HOSTED_PUBLIC_URL`; Google sign-in works.
- [ ] Switch Stripe to live keys and webhook; do one real $10 top-up yourself.
- [ ] `https://<your domain>/api/health` returns `{"ok":true}`, and the first screen is only the first question.
- [ ] Upload a short real video as a signed-in account and confirm the worker finishes it.
- [ ] Decide on `MAX_UPLOAD_MB` to match your Supabase file size limit.
