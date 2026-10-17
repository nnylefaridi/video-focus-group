# Panel

Show a short video to a paper-puppet board of AI reviewers modeled on well-known people in your field. Panel opens straight on a question, recommends a board for your niche, and returns timestamped, evidence-backed feedback with a revision plan. Reviewers are AI interpretations built from each person's published work. They don't take part in or endorse any review.

Panel runs on your own Mac. Your videos and reviews stay on your computer, and the only outside service it uses is Anthropic's API, with your own key.

## What you need

- **A Mac** with [Homebrew](https://brew.sh). Don't have Homebrew? Open Terminal and paste the install command from [brew.sh](https://brew.sh).
- **An Anthropic API key**, with billing set up. You pay Anthropic directly for what you use: a full review usually costs about **$1–2**, and the questions before it a fraction of a cent. Panel caps spending at $10 a day and $40 a month by default (see [Spending limits](#spending-limits)).
- About **1 GB** of free disk space.

## Set it up (once)

Open **Terminal** and run these one at a time.

1. **Install the tools Panel uses** (Node.js, ffmpeg for video, and whisper for speech-to-text):
   ```bash
   brew install node ffmpeg whisper-cpp
   ```
2. **Download Panel:**
   ```bash
   git clone https://github.com/nnylefaridi/video-focus-group.git
   ```
   ```bash
   cd video-focus-group
   ```
3. **Install its packages** (takes a minute or two):
   ```bash
   npm install
   ```
4. **Get your Anthropic API key.** Go to [console.anthropic.com](https://console.anthropic.com), sign up or log in, and add billing under **Settings → Billing**. Then open **Settings → API Keys**, click **Create Key**, name it `Panel`, and copy it (it starts with `sk-ant-`).
5. **Run the setup:**
   ```bash
   npm run setup
   ```
   It checks the tools, downloads the speech-to-text model (about 150 MB), asks you to paste your API key (and checks it works), and prepares Panel's built-in database. Your key is saved in `.env.local` on your computer only; it's never uploaded or committed.

**Strongly recommended:** in the Anthropic Console, open **Settings → Limits** and set a monthly spend limit for your key. Anthropic enforces it even if something on your computer goes wrong.

## Use it

Start Panel:
```bash
npm run dev
```
Then open **http://127.0.0.1:3000** in your browser.

- Answer a few questions about your video, check the board of reviewers, then upload the video (MP4, MOV or WebM, up to 3 minutes and 250 MB).
- The review takes a few minutes. You can leave the page and come back: past reviews are under **All reviews** (inside any review) at **http://127.0.0.1:3000/reviews**.
- Ask any reviewer follow-up questions in the **Discussion** tab, under **Ask a reviewer**.
- **To stop Panel**, go back to Terminal and press **Ctrl + C**. Next time, open Terminal, `cd video-focus-group`, and run `npm run dev` again.

Only your computer can open Panel: it listens on `127.0.0.1`, so nobody else on your network can reach it or spend your key.

## Update to the newest version

In Terminal, inside the `video-focus-group` folder (stop Panel first with Ctrl + C):
```bash
git pull
```
```bash
npm install
```
```bash
npm run setup
```

## Spending limits

Every paid call is checked against these first. To change one, add the line to `.env.local` (for example `DAILY_LIMIT_USD=5`) and restart Panel.

| Setting | Default | What happens when it's reached |
|---|---|---|
| `DAILY_LIMIT_USD` | 10 | No more paid calls until midnight |
| `MONTHLY_LIMIT_USD` | 40 | No more paid calls until the 1st |
| `REVIEW_COST_CAP_USD` | 3 | That review (and its follow-ups) stops spending |
| `MAX_REVIEWS_PER_DAY` | 8 | New reviews are refused until midnight |
| `MAX_FOLLOWUPS_PER_REVIEW` | 20 | No more follow-up questions on that review |
| `MAX_ANSWER_CHECKS_PER_HOUR` | 60 | Answers to the questions pause for a bit |

A new review is also refused if less than about $1.50 is left in today's or this month's budget. **Your reviews** shows what you've used and what Panel has spent today and this month.

## If something goes wrong

| What you see | What to do |
|---|---|
| `npm run setup` says a tool is missing | Run `brew install ffmpeg whisper-cpp`, then `npm run setup` again. |
| `command not found: npm` or `brew` | Install [Homebrew](https://brew.sh), then `brew install node`. Close and reopen Terminal. |
| "Anthropic rejected that key" | Copy the whole key again from the Anthropic Console (it starts with `sk-ant-`), and check billing is set up. |
| "Panel is already running in another Terminal window" | Use that window, or press Ctrl + C there first. |
| "Port 3000 is already in use" | Something else uses port 3000. Run `PORT=3001 npm run dev` and open http://127.0.0.1:3001. |
| A limit message ("budget is used up", "daily limit") | It resets at the time it says. To raise it, see [Spending limits](#spending-limits). |
| A review says "failed" | Press **Try again** in the review. Finished steps are kept, so it continues where it stopped. |
| Anything else | Stop Panel (Ctrl + C), run `npm run setup`, then `npm run dev` again. Error details appear in the Terminal window. |

Your reviews, videos and database are in the `data` folder. Deleting it removes them all (run `npm run setup` afterwards to start fresh).

## How a review works

1. **Questions** adapt to what you're making, and there are never more than five: the most useful one for your kind of video is asked next. Your first free-text answer is read by Claude Haiku, which fills in what it can so you skip questions you've already answered. Every answer can be changed from the board screen.
2. **Board.** Three reviewers are picked for your niche and goal, including at least one pair who tend to disagree. You can swap, add or remove reviewers. Click any name to see their sourced ideas.
3. **Upload.** MP4, MOV or WebM, up to 3 minutes and 250 MB. The server checks the actual file contents (not the extension), then normalizes the video and strips its metadata.
4. **Evidence.** The worker detects cuts, samples frames (densely in the first 3 seconds), transcribes speech with word timings, and measures pauses, silence and sound without speech. Claude Sonnet then describes each frame. Every item gets an id like `F012`, `T03`, `S02` or `A01`.
5. **Review.** Each reviewer (Claude Opus with that person's profile) watches the evidence on their own and must cite evidence ids and their own principle ids. The model never writes timestamps; the app derives them from the cited evidence. Validators drop anything with no evidence, any made-up quote, or any prediction of views or sales.
6. **The board.** In a paper puppet theatre, each reviewer is a cutout on a popsicle stick behind an origami table. The speaker's puppet wags while their line appears under the flat video player (whose CC button shows captions made from the transcript). The independent notes become a discussion with real disagreements, a comparison of where reviewers agree and differ, and a plan: *change these first*, *worth trying*, *keep these*.
7. **Ask.** Chat with any reviewer. They can take a closer look at any moment, re-sampling it at 8 frames per second.

## Optional: accounts with Supabase

You don't need this to use Panel. It adds sign-in (Google, or email and password) and keeps a record of reviews and their videos in a free [Supabase](https://supabase.com) project, which matters if more than one person uses the same copy. Without it, Panel runs in **local mode**: no sign-in, and every review on your computer is yours.


1. **Project.** Sign in at [supabase.com](https://supabase.com), create a new project (any name and region), and save the database password it asks you for.
2. **Keys.** In the project, open **Project Settings → API Keys** and copy into `.env.local`:
   - the Project URL → `NEXT_PUBLIC_SUPABASE_URL` (it looks like `https://abcd.supabase.co`)
   - the **publishable** key (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - a **secret** key (`sb_secret_…`) → `SUPABASE_SECRET_KEY`. This one stays on the server; it's what stores videos. Never share it.
3. **Database.** Click **Connect** at the top of the project, choose **Session pooler**, copy the connection string into `DATABASE_URL`, and replace `[YOUR-PASSWORD]` with the database password. The tables and the private `review-media` storage bucket are created automatically the first time the app starts (from `supabase/migrations`).
4. **Sign-in addresses.** **Authentication → URL Configuration**: set **Site URL** to `http://127.0.0.1:3000`, and add both `http://127.0.0.1:3000/**` and `http://localhost:3000/**` under **Redirect URLs** (the `/**` lets sign-in return with its destination attached).
5. **Email and password** is on by default.
   - **Sender.** Supabase's built-in mailer only emails your own Supabase team, a few times an hour. So anyone can get their links, add a sender under **Authentication → Emails → SMTP Settings**. A Gmail [app password](https://myaccount.google.com/apppasswords) works for free: host `smtp.gmail.com`, port `465`, your Gmail address as sender and username, the app password as password.
   - **Links that work in any browser.** Under **Authentication → Emails → Templates**, change the link in two templates so it goes straight to the app (otherwise a link opened in a different browser or on a phone fails):
     - **Confirm signup:** `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/reviews`
     - **Reset password:** `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/login/new-password`
6. **Google.** In [Google Cloud Console](https://console.cloud.google.com/apis/credentials): create a project, set up the **OAuth consent screen** (External), then **Create credentials → OAuth client ID → Web application**. Under **Authorized redirect URIs** add `https://<your-project>.supabase.co/auth/v1/callback`. Copy the client ID and secret into Supabase under **Authentication → Sign In / Providers → Google**, and turn it on.
7. **Restart** Panel (Ctrl+C, then `npm run dev`). **Your reviews** now asks people to log in to keep a record, and reviews made in a browser before signing in move into the account.

With accounts on:
- Each review is visible only to its account (or, before sign-in, the browser that made it). The tables live in a schema Supabase's public API doesn't expose, with row level security on, so only Panel's server can read them.
- Signed-in people's videos, posters, captions and frames are copied to the private `review-media` bucket and shown through six-hour signed links. The free plan has 1 GB (a review takes about 3–10 MB); videos over its 50 MB file limit are re-encoded at 720p to fit.
- Limits are per account when signed in and per network when signed out, with an overall ceiling per network (`MAX_REVIEWS_PER_NETWORK_PER_DAY`, default 40; `MAX_ANSWER_CHECKS_PER_NETWORK_PER_HOUR`, default 300). Signed-in people see their limits on **Your reviews**; add your email to `OWNER_EMAILS` to also see what the app has spent.
- Reviews from an older version of Panel (`data/app.db`) can be moved into an account: `npm run db:import-local -- --email you@example.com`.

## For developers

### How it's built

- **Database.** Postgres. Without `DATABASE_URL`, `npm run dev` runs a built-in one (the `embedded-postgres` package, data in `data/pg`, listening only on `127.0.0.1:54329`) and stops it on Ctrl + C. With `DATABASE_URL` set, it uses that database (e.g. Supabase). Tables live in the `app` schema; migrations in `supabase/migrations` apply automatically on first use.
- **Website and worker.** `npm run dev` starts both: the website through `server.mjs` (which reads each visitor's address from the connection itself, so limits can't be dodged with a forged `X-Forwarded-For`) and the background worker that processes videos. `npm run build` then `npm start` does the same with a production build.
- **Limits** are reserved in the database before any paid call, inside locks, so parallel tabs can't slip past them. Only a keyed hash of the visitor's address is stored. A review whose upload is rejected or abandoned is given back; deleting a finished review is not.

## Checks

```bash
npm run check   # typecheck, lint, unit + upload tests, design bans, profiles (tests use an in-process Postgres, no Supabase needed)
npm run e2e     # browser tests at desktop and phone sizes
npm run smoke -- path/to/video.mp4      # one real review end to end (needs the key and a running worker)
npm run eval    # scores finished reviews, writes a blind identification sheet
```

`npm run lint:design` enforces the visual rules: no gradients, no purple, no glow or blur, no colored left/top card borders, no eyebrow badges, no sparkle or magic-wand icons.

## Reviewers

Profiles live in `src/experts/profiles/*.yaml`, following the schema in `src/core/expert.ts`. Each principle is a paraphrase linked to sources, with a confidence level. Short verbatim excerpts are included only where they were checked word for word. Only verified principles are used.

```bash
npm run kb:validate              # structure and references
npm run kb:validate -- --urls    # also check every source link
```

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
| `data/` | Media, the built-in database, the speech model (git-ignored) |
