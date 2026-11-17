# Video Focus Group

Video Focus Group is a local app for people who make short videos. You answer a few questions, it recommends a board of AI reviewers modeled on well-known people in your field, and it comes back with timestamped, evidence-backed notes and a revision plan. Your videos and reviews stay on your computer. A review sends sampled frames and the transcript to Anthropic with your own API key. Your browser prepares the video on your own device first (a smaller 720p copy, stills and a transcript), using a speech-to-text model it downloads once (about 79 MB, from Hugging Face). Those are the only outside services it uses.

![A real review in Video Focus Group, from the opening question through the board, processing, the video, a follow-up, and the revision plan](.github/assets/panel-demo.gif)

> **About the reviewers.** Video Focus Group isn't affiliated with, sponsored by or endorsed by any of the people it names (Mark Rober, Casey Neistat, MrBeast, Alex Hormozi and the others in `src/experts/profiles`). Each reviewer is Claude prompted with a summary of that person's public talks, books and interviews, linked to its sources. What a reviewer says is the model's reading of those ideas, not the person's opinion, and the cartoon likenesses are illustrations, not their photos or logos.

## What you need

- **Node.js 20.9 or newer** (npm comes with it)
- **A recent Chrome, Edge, Safari or Firefox.** Your browser prepares the video (it needs WebCodecs, which these have).
- **An Anthropic API key with billing turned on.** You pay Anthropic directly. Create the key at [console.anthropic.com](https://console.anthropic.com) under **Settings → API Keys**.
- About **500 MB** of free disk for the app and your reviews.

**What a review costs.** In our own testing, across 8 finished reviews, a review cost $0.92 on average and $1.27 at most. Video Focus Group refuses to start one when less than **$1.50** is left today or this month (`typicalReviewUsd`), stops that review and its follow-ups at **$3** (`REVIEW_COST_CAP_USD`), and stops the app at **$10** a day and **$40** a month (`DAILY_LIMIT_USD`, `MONTHLY_LIMIT_USD`). Those are defaults. Calls are priced in `src/ai/client.ts`: Haiku for the opening questions, Sonnet for frames, Opus for each reviewer. What you pay still depends on the video. In the Anthropic Console, open **Settings → Limits** and set a hard monthly spend limit on the key. Anthropic enforces that even if something on your computer goes wrong.

Video Focus Group runs on macOS and Ubuntu 24.04. Windows isn't supported yet.

## Set it up (once)

### macOS

Install [Homebrew](https://brew.sh), then:

```bash
brew install node
```

Check `node -v` (20.9 or newer).

### Ubuntu 24.04

Ubuntu 24.04's `nodejs` package is 18.19.1, which is too old. Don't install Node from apt on this release. Install Node.js 22 from nodejs.org:

```bash
sudo apt update
sudo apt install -y curl ca-certificates xz-utils
VER=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/node-v[0-9.]+-linux-x64\.tar\.xz$/ { print $2; exit }')
curl -fsSL -o "/tmp/$VER" "https://nodejs.org/dist/latest-v22.x/$VER"
sudo tar -xJf "/tmp/$VER" -C /usr/local --strip-components=1
hash -r
node -v && npm -v
```

`node -v` should print v22. These commands are for x86_64. On arm64, `npm run setup` prints the same steps with `linux-arm64` in the filename.

### Then, on either system

1. **Download Video Focus Group:**

   ```bash
   git clone https://github.com/nnylefaridi/video-focus-group.git
   cd video-focus-group
   ```

2. **Install its packages** (takes a minute or two):

   ```bash
   npm install
   ```

3. **Get an Anthropic API key.** In [console.anthropic.com](https://console.anthropic.com), add billing under **Settings → Billing**. Then open **Settings → API Keys**, click **Create Key**, name it `Video Focus Group`, and copy it (it starts with `sk-ant-`).

4. **Run setup:**

   ```bash
   npm run setup
   ```

   It checks your Node version and prints the install command if it's too old, asks you to paste your API key and checks that Anthropic accepts it, and prepares the built-in database. The key is written to `.env.local` on your computer only. Setup does not print the key. `.env.local` is not committed.

   If you don't have a key yet:

   ```bash
   npm run setup -- --skip-key
   ```

   That finishes the rest of setup. Add `ANTHROPIC_API_KEY=sk-ant-...` to `.env.local` later, or run `npm run setup` again in a terminal and paste it. Video Focus Group will open without a key. A review will not run until the key is there.

**Strongly recommended:** in the Anthropic Console, open **Settings → Limits** and set a monthly spend limit for your key.

## Use it

Start Video Focus Group:

```bash
npm run dev
```

Then open **http://127.0.0.1:3000** in your browser.

- Answer a few questions about your video, check the board of reviewers, then upload the video (MP4, MOV or WebM, up to 3 minutes). Your browser prepares it first: the first time, it downloads the speech model (about 79 MB), and preparing takes about as long as the video on a laptop, longer on a phone. Keep the tab open until it's sent.
- The review takes a few minutes. You can leave the page and come back: past reviews are under **All reviews** (inside any review) at **http://127.0.0.1:3000/reviews**.
- Ask any reviewer follow-up questions in the **Discussion** tab, under **Ask a reviewer**.
- **To stop Video Focus Group**, go back to the terminal and press **Ctrl + C**. Next time, `cd video-focus-group` and run `npm run dev` again.

Only your computer can open Video Focus Group: it listens on `127.0.0.1`, so nobody else on your network can reach it or spend your key.

## Update to the newest version

In the `video-focus-group` folder (stop Video Focus Group first with Ctrl + C):

```bash
git pull
npm install
npm run setup
```

## If something goes wrong

| What you see | What to do |
|---|---|
| `npm run setup` says Node is too old, or `command not found: npm` | On a Mac, `brew install node` or `brew upgrade node`. On Ubuntu 24.04, apt's Node is 18. Use the Node.js 22 steps above, then open a new terminal. |
| The upload step says this browser can't prepare videos | Use a recent Chrome, Edge, Safari or Firefox. |
| "Getting the speech reader ready" doesn't move | The browser downloads the speech model once (about 79 MB from huggingface.co, and its runtime from cdn.jsdelivr.net). Check your connection, or that nothing blocks those sites, and try again. |
| "Anthropic rejected that key" | Copy the whole key again (it starts with `sk-ant-`) and check billing is set up under **Settings → Billing**. Setup does not print the key. |
| "Anthropic rejected the API key in .env.local" or "out of credits" | Run `npm run setup` and paste a working key, or add credits under **Settings → Billing**. Then restart Video Focus Group. |
| "Couldn't reach Anthropic to check it, so it's saved as is." | The key was written without a live check. Start Video Focus Group, and if a review says the key was rejected, replace it. |
| "Video Focus Group is already running in another Terminal window" | The built-in database port (54329) is already open. Use that window, or press Ctrl + C there first. |
| "The local database couldn't start" or "couldn't be created" | Read the reason in the message. Files live in `data/pg` and the database only listens on `127.0.0.1:54329`. If a previous run was left behind, stop Video Focus Group and try again. Deleting `data/pg` removes reviews stored in the built-in database; run `npm run setup` afterwards. |
| "Port 3000 is already in use" | Something else is using port 3000. Run `PORT=3001 npm run dev` and open http://127.0.0.1:3001. |
| A limit message ("budget is used up", "daily limit") | It resets at the time it says. To raise it, see [Spending limits](#spending-limits). |
| A review says "failed" | Press **Try again** in the review. Finished steps are kept, so it continues where it stopped. |
| Anything else | Stop Video Focus Group (Ctrl + C), run `npm run setup`, then `npm run dev` again. Error details appear in the terminal. |

Your reviews, videos and database are in the `data` folder. Deleting it removes them all (run `npm run setup` afterwards to start fresh).

## Spending limits

Every paid call is checked against these first. To change one, add the line to `.env.local` (for example `DAILY_LIMIT_USD=5`) and restart Video Focus Group.

| Setting | Default | What happens when it's reached |
|---|---|---|
| `DAILY_LIMIT_USD` | 10 | No more paid calls until midnight |
| `MONTHLY_LIMIT_USD` | 40 | No more paid calls until the 1st |
| `REVIEW_COST_CAP_USD` | 3 | That review (and its follow-ups) stops spending |
| `MAX_REVIEWS_PER_DAY` | 8 | New reviews are refused until midnight |
| `MAX_FOLLOWUPS_PER_REVIEW` | 20 | No more follow-up questions on that review |
| `MAX_ANSWER_CHECKS_PER_HOUR` | 60 | Answers to the questions pause for a bit |

A new review is also refused if less than $1.50 is left in today's or this month's budget. **Your reviews** shows what you've used and what Video Focus Group has spent today and this month.

## How a review works

1. **Questions** adapt to what you're making, and there are never more than five: the most useful one for your kind of video is asked next. Your first free-text answer is read by Claude Haiku, which fills in what it can so you skip questions you've already answered. Every answer can be changed from the board screen.
2. **Board.** Three reviewers are picked for your niche and goal, including at least one pair who tend to disagree. You can swap, add or remove reviewers. Click any name to see their sourced ideas.
3. **Upload.** MP4, MOV or WebM, up to 3 minutes. Your browser makes a 720p H.264 copy without the original's metadata, plus a poster, the stills the plan asks for and sprite sheets (4 stills a second) for close looks later, and sends those. The server checks every file it receives (the exact set, sizes, the MP4's header, every JPEG) before anything paid runs.
4. **Evidence.** Your browser detects cuts, takes stills (densely in the first 3 seconds), transcribes speech with word timings (Whisper base, running in the browser), and measures loudness and silence; the server works out pauses, speech rate and sound without speech from those. Claude Sonnet then describes each still. Every item gets an id like `F012`, `T03`, `S02` or `A01`.
5. **Review.** Each reviewer (Claude Opus with that person's profile) watches the evidence on their own and must cite evidence ids and their own principle ids. The model never writes timestamps; the app derives them from the cited evidence. Validators drop anything with no evidence, any made-up quote, or any prediction of views or sales.
6. **The board.** In a paper puppet theatre, each reviewer is a cutout on a popsicle stick behind an origami table. The speaker's puppet wags while their line appears under the flat video player (whose CC button shows captions made from the transcript). The independent notes become a discussion with real disagreements, a comparison of where reviewers agree and differ, and a plan: *change these first*, *worth trying*, *keep these*.
7. **Ask.** Chat with any reviewer. They can take a closer look at any moment, using the stills (4 a second) made when the video was prepared.

## Optional: accounts with Supabase

You don't need this to use Video Focus Group. It adds sign-in (Google, or email and password) and keeps a record of reviews and their videos in a free [Supabase](https://supabase.com) project, which matters if more than one person uses the same copy. Without it, Video Focus Group runs in **local mode**: no sign-in, and every review on your computer is yours.


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
7. **Restart** Video Focus Group (Ctrl+C, then `npm run dev`). **Your reviews** now asks people to log in to keep a record, and reviews made in a browser before signing in move into the account.

With accounts on:
- Each review is visible only to its account (or, before sign-in, the browser that made it). The tables live in a schema Supabase's public API doesn't expose, with row level security on, so only Video Focus Group's server can read them.
- Signed-in people's videos, posters, captions and frames are copied to the private `review-media` bucket and shown through six-hour signed links. The free plan has 1 GB; the browser always sends a 720p copy, so a review takes about 5–30 MB. A file over the 50 MB limit isn't copied and stays on this computer only.
- Limits are per account when signed in and per network when signed out, with an overall ceiling per network (`MAX_REVIEWS_PER_NETWORK_PER_DAY`, default 40; `MAX_ANSWER_CHECKS_PER_NETWORK_PER_HOUR`, default 300). Signed-in people see their limits on **Your reviews**; add your email to `OWNER_EMAILS` to also see what the app has spent.
- Reviews from an older version of Video Focus Group (`data/app.db`) can be moved into an account: `npm run db:import-local -- --email you@example.com`.

## For developers

### How it's built

- **Database.** Postgres. Without `DATABASE_URL`, `npm run dev` runs a built-in one (the `embedded-postgres` package, data in `data/pg`, listening only on `127.0.0.1:54329`) and stops it on Ctrl + C. With `DATABASE_URL` set, it uses that database (e.g. Supabase). Tables live in the `app` schema; migrations in `supabase/migrations` apply automatically on first use.
- **One process.** `npm run dev` starts Next.js's own server (`next dev`, on `127.0.0.1:3000` unless you set `PORT` or `HOST`), and the reviews are made inside that same process by a runner that takes jobs from Postgres (`src/server/runner.ts`). There's no separate worker. `npm run build` then `npm start` does the same with a production build (`next start`). In local mode there's one person, so every request counts as the same visitor for the limits; hosted mode tells visitors apart with `CLIENT_IP_HEADER` or `TRUSTED_PROXIES` (see `.env.example`).
- **Limits** are reserved in the database before any paid call, inside locks, so parallel tabs can't slip past them. Only a keyed hash of the visitor's address is stored. A review whose upload is rejected or abandoned is given back; deleting a finished review is not.

## Checks

```bash
npm run check   # typecheck, lint, unit + upload tests, design bans, profiles (tests use an in-process Postgres, no Supabase needed)
npm run e2e     # browser tests at desktop and phone sizes (run as `ANTHROPIC_API_KEY= npm run e2e` to make no Anthropic calls)
npm run e2e:browser   # a real video prepared in the browser, up to the first Claude call (a local stand-in answers it; nothing is paid for)
npm run e2e:hosted    # hosted mode on Next.js's production server: the redirect and the health check
npm run smoke -- <review-id>      # re-runs the paid steps of one review already prepared in the browser (needs the key)
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
| `src/media` | In-browser preparation (`browser/`: conversion, stills, speech in a Web Worker), the evidence built from what the browser sends (`analysis/`), and the MP4 header check |
| `src/ai` | Claude calls, prompts, validators |
| `src/components/puppets` | The hand-drawn SVG puppets (one look per reviewer) and their wag animations |
| `src/server` | Database, sign-in, per-person limits, storage, signed media URLs, jobs, review processing |
| `src/proxy.ts` | Keeps the Supabase sign-in session fresh; hosted mode's redirect to its one public address |
| `src/instrumentation.ts` | Runs at server start: checks hosted settings, resumes unfinished reviews |
| `supabase/migrations` | Database tables and the storage bucket (applied automatically) |
| `scripts/dev.mjs`, `scripts/start.mjs` | Start the built-in database (local mode) and Next.js's server |
| `scripts/setup.mjs` | Node check, API key, built-in database |
| `render.yaml`, `Dockerfile`, `fly.toml` | Hosting the public site: Render first, Fly second (`docs/hosting.md`) |
| `data/` | Media and the built-in database (git-ignored; never copied into a build) |

## License

The code is released under the [MIT License](LICENSE). The names of the people Video Focus Group's reviewers are modeled on, and their likenesses, belong to those people and aren't covered by it.
