# Panel

Panel is a local app for people who make short videos. You answer a few questions, it recommends a board of AI reviewers modeled on well-known people in your field, and it comes back with timestamped, evidence-backed notes and a revision plan. Your videos and reviews stay on your computer. A review sends sampled frames and the transcript to Anthropic with your own API key. That, plus a one-time download of the speech-to-text model, is the only outside service it uses.

![A real review in Panel, from the opening question through the board, processing, the video, a follow-up, and the revision plan](.github/assets/panel-demo.gif)

> **About the reviewers.** Panel isn't affiliated with, sponsored by or endorsed by any of the people it names (Mark Rober, Casey Neistat, MrBeast, Alex Hormozi and the others in `src/experts/profiles`). Each reviewer is Claude prompted with a summary of that person's public talks, books and interviews, linked to its sources. What a reviewer says is the model's reading of those ideas, not the person's opinion, and the cartoon likenesses are illustrations, not their photos or logos.

## What you need

- **Node.js 20.9 or newer** (npm comes with it)
- **ffmpeg**, including **ffprobe**
- **whisper.cpp**, the `whisper-cli` program
- **An Anthropic API key with billing turned on.** You pay Anthropic directly. Create the key at [console.anthropic.com](https://console.anthropic.com) under **Settings → API Keys**.
- About **1 GB** of free disk. The speech model is about 148 MB.

**What a review costs.** In our own testing, across 8 finished reviews, a review cost $0.92 on average and $1.27 at most. Panel refuses to start one when less than **$1.50** is left today or this month (`typicalReviewUsd`), stops that review and its follow-ups at **$3** (`REVIEW_COST_CAP_USD`), and stops the app at **$10** a day and **$40** a month (`DAILY_LIMIT_USD`, `MONTHLY_LIMIT_USD`). Those are defaults. Calls are priced in `src/ai/client.ts`: Haiku for the opening questions, Sonnet for frames, Opus for each reviewer. What you pay still depends on the video. In the Anthropic Console, open **Settings → Limits** and set a hard monthly spend limit on the key. Anthropic enforces that even if something on your computer goes wrong.

Panel runs on macOS and Ubuntu 24.04. Windows isn't supported yet.

## Set it up (once)

### macOS

Install [Homebrew](https://brew.sh), then:

```bash
brew install node ffmpeg whisper-cpp
```

Check `node -v` (20.9 or newer), `ffmpeg -version`, `ffprobe -version`, and `whisper-cli -h`. The Homebrew formula is named `whisper-cpp`. The program is named `whisper-cli`. An older whisper.cpp program named `main` is retired and will not transcribe.

### Ubuntu 24.04

Open a terminal in the folder where you want Panel, and run these one at a time.

1. **Packages** (ffmpeg and ffprobe, a compiler for whisper.cpp, and the tools that download Node):

   ```bash
   sudo apt update
   sudo apt install -y ffmpeg build-essential cmake git curl ca-certificates xz-utils
   ```

2. **Node.js 22** from nodejs.org. Ubuntu 24.04's `nodejs` package is 18.19.1, which is too old. Don't install Node from apt on this release.

   ```bash
   VER=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/node-v[0-9.]+-linux-x64\.tar\.xz$/ { print $2; exit }')
   curl -fsSL -o "/tmp/$VER" "https://nodejs.org/dist/latest-v22.x/$VER"
   sudo tar -xJf "/tmp/$VER" -C /usr/local --strip-components=1
   hash -r
   node -v && npm -v
   ```

   `node -v` should print v22. These commands are for x86_64. On arm64, `npm run setup` prints the same steps with `linux-arm64` in the filename.

3. **whisper.cpp** v1.9.5. Ubuntu 24.04 does not package it. The program Panel runs is `whisper-cli`.

   ```bash
   git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp.git
   cd whisper.cpp
   cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++
   cmake --build build -j 2
   sudo cmake --install build
   sudo ldconfig
   whisper-cli -h
   cd ..
   ```

   `gcc` and `g++` are set on purpose. `-j 2` keeps the compile from using every core; a higher count can run out of memory. If `whisper-cli` says it cannot find `libwhisper.so.1`, run `sudo ldconfig` again.

### Then, on either system

1. **Download Panel:**

   ```bash
   git clone https://github.com/nnylefaridi/video-focus-group.git
   cd video-focus-group
   ```

2. **Install its packages** (takes a minute or two):

   ```bash
   npm install
   ```

3. **Get an Anthropic API key.** In [console.anthropic.com](https://console.anthropic.com), add billing under **Settings → Billing**. Then open **Settings → API Keys**, click **Create Key**, name it `Panel`, and copy it (it starts with `sk-ant-`).

4. **Run setup:**

   ```bash
   npm run setup
   ```

   It checks the tools and prints the install command for anything missing. It downloads the speech-to-text model (about 148 MB), asks you to paste your API key and checks that Anthropic accepts it, and prepares the built-in database. The key is written to `.env.local` on your computer only. Setup does not print the key. `.env.local` is not committed.

   If you don't have a key yet:

   ```bash
   npm run setup -- --skip-key
   ```

   That finishes the rest of setup. Add `ANTHROPIC_API_KEY=sk-ant-...` to `.env.local` later, or run `npm run setup` again in a terminal and paste it. Panel will open without a key. A review will not run until the key is there.

**Strongly recommended:** in the Anthropic Console, open **Settings → Limits** and set a monthly spend limit for your key.

## Use it

Start Panel:

```bash
npm run dev
```

Then open **http://127.0.0.1:3000** in your browser.

- Answer a few questions about your video, check the board of reviewers, then upload the video (MP4, MOV or WebM, up to 3 minutes and 250 MB).
- The review takes a few minutes. You can leave the page and come back: past reviews are under **All reviews** (inside any review) at **http://127.0.0.1:3000/reviews**.
- Ask any reviewer follow-up questions in the **Discussion** tab, under **Ask a reviewer**.
- **To stop Panel**, go back to the terminal and press **Ctrl + C**. Next time, `cd video-focus-group` and run `npm run dev` again.

Only your computer can open Panel: it listens on `127.0.0.1`, so nobody else on your network can reach it or spend your key.

## Update to the newest version

In the `video-focus-group` folder (stop Panel first with Ctrl + C):

```bash
git pull
npm install
npm run setup
```

## If something goes wrong

| What you see | What to do |
|---|---|
| `npm run setup` says Node is too old, or `command not found: npm` | On a Mac, `brew install node` or `brew upgrade node`. On Ubuntu 24.04, apt's Node is 18. Use the Node.js 22 steps above, then open a new terminal. |
| `npm run setup` says ffmpeg, ffprobe, or whisper-cli is missing | Run the command it prints. On a Mac that is `brew install ffmpeg` or `brew install whisper-cpp`. On Ubuntu 24.04 that is `sudo apt install -y ffmpeg` for the video tools, and the whisper.cpp build above for `whisper-cli`. Then run `npm run setup` again. |
| `whisper-cli: error while loading shared libraries: libwhisper.so.1` | Run `sudo ldconfig`, then `whisper-cli -h`. |
| `Couldn't download the speech-to-text model` | Setup downloads it from huggingface.co into `data/models/ggml-base.en.bin` (about 148 MB). Check your connection and run `npm run setup` again. A partial download is deleted and started over. |
| "Anthropic rejected that key" | Copy the whole key again (it starts with `sk-ant-`) and check billing is set up under **Settings → Billing**. Setup does not print the key. |
| "Anthropic rejected the API key in .env.local" or "out of credits" | Run `npm run setup` and paste a working key, or add credits under **Settings → Billing**. Then restart Panel. |
| "Couldn't reach Anthropic to check it, so it's saved as is." | The key was written without a live check. Start Panel, and if a review says the key was rejected, replace it. |
| "Panel is already running in another Terminal window" | The built-in database port (54329) is already open. Use that window, or press Ctrl + C there first. |
| "The local database couldn't start" or "couldn't be created" | Read the reason in the message. Files live in `data/pg` and the database only listens on `127.0.0.1:54329`. If a previous run was left behind, stop Panel and try again. Deleting `data/pg` removes reviews stored in the built-in database; run `npm run setup` afterwards. |
| "Port 3000 is already in use" | Something else is using port 3000. Run `PORT=3001 npm run dev` and open http://127.0.0.1:3001. |
| A limit message ("budget is used up", "daily limit") | It resets at the time it says. To raise it, see [Spending limits](#spending-limits). |
| A review says "failed" | Press **Try again** in the review. Finished steps are kept, so it continues where it stopped. |
| Anything else | Stop Panel (Ctrl + C), run `npm run setup`, then `npm run dev` again. Error details appear in the terminal. |

Your reviews, videos and database are in the `data` folder. Deleting it removes them all (run `npm run setup` afterwards to start fresh).

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

A new review is also refused if less than $1.50 is left in today's or this month's budget. **Your reviews** shows what you've used and what Panel has spent today and this month.

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
| `scripts/setup.mjs` | Tool check, model download, API key, built-in database |
| `data/` | Media, the built-in database, the speech model (git-ignored) |

## License

The code is released under the [MIT License](LICENSE). The names of the people Panel's reviewers are modeled on, and their likenesses, belong to those people and aren't covered by it.
