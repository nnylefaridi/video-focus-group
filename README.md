# Panel

Show a short video to a paper-puppet board of AI reviewers modeled on well-known people in your field. The app opens straight on a question, recommends a board for your niche, and returns timestamped, evidence-backed feedback with a revision plan. Reviewers are AI interpretations built from each person's published work. They don't take part in or endorse any review.

Video processing runs on your Mac. Accounts, the database and stored videos live in a free Supabase project. Nobody needs an account to use the app; signing in (Google, or email and password) is only for keeping a record of past reviews.

## One-time setup

1. **Tools.** Install these with Homebrew:
   ```bash
   brew install node ffmpeg whisper-cpp
   ```
2. **Speech-to-text model** (about 150 MB):
   ```bash
   mkdir -p data/models && curl -L -o data/models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
   ```
3. **Dependencies:**
   ```bash
   npm install
   ```
4. **Anthropic API key.** Create a key at [console.anthropic.com](https://console.anthropic.com) (Settings → API Keys, with billing set up). Then:
   ```bash
   cp .env.example .env.local
   ```
   Paste the key after `ANTHROPIC_API_KEY=` in `.env.local`. That file is git-ignored, and the key is only ever used on the server.
5. **Supabase** (free plan). See [Supabase setup](#supabase-setup) below.

## Supabase setup

1. **Project.** Sign in at [supabase.com](https://supabase.com), create a new project (any name and region), and save the database password it asks you for.
2. **Keys.** In the project, open **Project Settings → API Keys** and copy into `.env.local`:
   - the Project URL → `NEXT_PUBLIC_SUPABASE_URL` (it looks like `https://abcd.supabase.co`)
   - the **publishable** key (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - a **secret** key (`sb_secret_…`) → `SUPABASE_SECRET_KEY`. This one stays on the server; it's what stores videos.
3. **Database.** Click **Connect** at the top of the project, choose **Session pooler**, copy the connection string into `DATABASE_URL`, and replace `[YOUR-PASSWORD]` with the database password. The tables and the private `review-media` storage bucket are created automatically the first time the app starts (from `supabase/migrations`).
4. **Sign-in addresses.** **Authentication → URL Configuration**: set **Site URL** to `http://127.0.0.1:3000`, and add both `http://127.0.0.1:3000/auth/callback` and `http://localhost:3000/auth/callback` under **Redirect URLs**.
5. **Email and password** is on by default.
   - **Sender.** Supabase's built-in mailer only emails your own Supabase team, a few times an hour. So anyone can get their links, add a sender under **Authentication → Emails → SMTP Settings**. A Gmail [app password](https://myaccount.google.com/apppasswords) works for free: host `smtp.gmail.com`, port `465`, your Gmail address as sender and username, the app password as password.
   - **Links that work in any browser.** Under **Authentication → Emails → Templates**, change the link in two templates so it goes straight to the app (otherwise a link opened in a different browser or on a phone fails):
     - **Confirm signup:** `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/reviews`
     - **Reset password:** `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/login/new-password`
6. **Google.** In [Google Cloud Console](https://console.cloud.google.com/apis/credentials): create a project, set up the **OAuth consent screen** (External), then **Create credentials → OAuth client ID → Web application**. Under **Authorized redirect URIs** add `https://<your-project>.supabase.co/auth/v1/callback`. Copy the client ID and secret into Supabase under **Authentication → Sign In / Providers → Google**, and turn it on.
7. **Your earlier reviews.** Reviews made before Supabase were in `data/app.db`. Sign up in the app, then move them into your account (the worker copies their videos to storage):
   ```bash
   npm run db:import-local -- --email you@example.com
   ```

## Run it

```bash
npm run dev
```

Open http://127.0.0.1:3000 (or http://localhost:3000). This starts the web app and the background worker that processes videos. After changing `.env.local`, stop with Ctrl+C and start it again.

## Accounts and your record of reviews

- **No account needed** to make a review. A review made while signed out belongs to that browser (an anonymous cookie) and can be opened from it.
- **Your reviews** asks you to log in to keep a record. Sign-in is Google, or email and password (with email confirmation and password reset). When you sign in, the reviews you made in that browser move into your account.
- **Kept reviews** are stored in Supabase: the review in the database, and its video, poster, captions and sampled frames in the private `review-media` bucket (at `<user id>/<review id>/`). The browser only ever gets six-hour signed links. Videos over the free plan's 50 MB file limit are re-encoded at 720p to fit. Signed-out reviews' media stays on this Mac only.
- **Privacy.** Each review is visible only to its account (or, before sign-in, its browser). The database tables live in a schema the Supabase Data API doesn't expose, with row level security on, so only this app's server can read them.
- The free plan has 1 GB of storage; a kept review usually takes 3–10 MB.

## How a review works

1. **Questions** adapt to what you're making, and there are never more than five: the most useful one for your kind of video is asked next. Your first free-text answer is read by Claude Haiku, which fills in what it can so you skip questions you've already answered. Every answer can be changed from the board screen.
2. **Board.** Three reviewers are picked for your niche and goal, including at least one pair who tend to disagree. You can swap, add or remove reviewers. Click any name to see their sourced ideas.
3. **Upload.** MP4, MOV or WebM, up to 3 minutes and 250 MB. The server checks the actual file contents (not the extension), then normalizes the video and strips its metadata.
4. **Evidence.** The worker detects cuts, samples frames (densely in the first 3 seconds), transcribes speech with word timings, and measures pauses, silence and sound without speech. Claude Sonnet then describes each frame. Every item gets an id like `F012`, `T03`, `S02` or `A01`.
5. **Review.** Each reviewer (Claude Opus with that person's profile) watches the evidence on their own and must cite evidence ids and their own principle ids. The model never writes timestamps; the app derives them from the cited evidence. Validators drop anything with no evidence, any made-up quote, or any prediction of views or sales.
6. **The board.** In a paper puppet theatre, each reviewer is a cutout on a popsicle stick behind an origami table. The speaker's puppet wags while their line appears under the flat video player (whose CC button shows captions made from the transcript). The independent notes become a discussion with real disagreements, a comparison of where reviewers agree and differ, and a plan: *change these first*, *worth trying*, *keep these*.
7. **Ask.** Chat with any reviewer. They can take a closer look at any moment, re-sampling it at 8 frames per second.

## Protecting your API key and budget

- **Only this computer can use the app.** The servers listen on `127.0.0.1`, so other devices on your network can't reach it or spend your key.
- **Spending caps**, checked before every paid call (answer checks, reviews and follow-ups). Change any of them in `.env.local`:

  | Setting | Default | Applies to | What happens when it's reached |
  |---|---|---|---|
  | `DAILY_LIMIT_USD` | 10 | the whole app | No more paid calls until midnight |
  | `MONTHLY_LIMIT_USD` | 40 | the whole app | No more paid calls until the 1st |
  | `REVIEW_COST_CAP_USD` | 3 | each review | That review (and its follow-ups) stops spending |
  | `MAX_REVIEWS_PER_DAY` | 8 | each person | New reviews are refused until midnight |
  | `MAX_FOLLOWUPS_PER_REVIEW` | 20 | each review | No more follow-up questions on that review |
  | `MAX_ANSWER_CHECKS_PER_HOUR` | 60 | each person | Questionnaire answers pause for a bit |

  **Each person** means each IP address: every tab, window and browser on one connection shares one allowance, signed in or not (IPv6 addresses are grouped by their /64 network). A use is reserved before the paid work starts, inside a database lock on that person, so tabs racing each other can't slip past a limit. Only a keyed hash of the address is stored. A review whose upload is rejected or abandoned is given back; deleting a finished review is not. The address is read from the connection itself by `server.mjs` (which `npm run dev` and `npm start` use), so a browser can't fake a new one with an `X-Forwarded-For` header. If you deploy behind proxies that append to `X-Forwarded-For`, set `TRUSTED_PROXIES` to how many there are, or set `CLIENT_IP_HEADER` to the header your host overwrites with the visitor's address.

  A new review is also refused if less than about $1.50 (a typical review) is left in today's or this month's budget. Signed-in people see their own limits on **Your reviews**. Add your email to `OWNER_EMAILS` to also see the app's spend there.
- **Hard backstop:** also set a monthly spend limit for your key in the Anthropic Console (Settings → Limits). That limit is enforced by Anthropic even if something here goes wrong.

## Reviewers

Profiles live in `src/experts/profiles/*.yaml`, following the schema in `src/core/expert.ts`. Each principle is a paraphrase linked to sources, with a confidence level. Short verbatim excerpts are included only where they were checked word for word. Only verified principles are used.

```bash
npm run kb:validate              # structure and references
npm run kb:validate -- --urls    # also check every source link
```

## Checks

```bash
npm run check   # typecheck, lint, unit + upload tests, design bans, profiles (tests use an in-process Postgres, no Supabase needed)
npm run e2e     # browser tests at desktop and phone sizes
npm run smoke -- path/to/video.mp4      # one real review end to end (needs the key and a running worker)
npm run eval    # scores finished reviews, writes a blind identification sheet
```

`npm run lint:design` enforces the visual rules: no gradients, no purple, no glow or blur, no colored left/top card borders, no eyebrow badges, no sparkle or magic-wand icons.

## Where things live

| Path | What |
|---|---|
| `src/core` | Shared types and pure logic: questionnaire engine, board recommender, evidence spans |
| `src/media` | ffmpeg/ffprobe/whisper pipeline |
| `src/ai` | Claude calls, prompts, validators |
| `src/components/puppets` | The hand-drawn SVG puppets (one look per reviewer) and their wag animations |
| `src/server` | Database, sign-in, per-person limits, storage, signed media URLs, jobs, review processing |
| `src/proxy.ts` | Keeps the Supabase sign-in session fresh |
| `supabase/migrations` | Database tables and the storage bucket (applied automatically) |
| `worker/` | Background worker loop (processing, and copying kept reviews' media to storage) |
| `data/` | Working media files, models (git-ignored) |
