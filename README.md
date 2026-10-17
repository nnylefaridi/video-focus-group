# Panel

Show a short video to a paper-puppet board of AI reviewers modeled on well-known people in your field. The app opens straight on a question, recommends a board for your niche, and returns timestamped, evidence-backed feedback with a revision plan. Reviewers are AI interpretations built from each person's published work. They don't take part in or endorse any review.

Everything runs locally on your Mac.

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

## Run it

```bash
npm run dev
```

Open http://127.0.0.1:3000 (or http://localhost:3000). This starts the web app and the background worker that processes videos. After changing `.env.local`, stop with Ctrl+C and start it again.

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

  | Setting | Default | What happens when it's reached |
  |---|---|---|
  | `DAILY_LIMIT_USD` | 10 | No more paid calls until midnight |
  | `MONTHLY_LIMIT_USD` | 40 | No more paid calls until the 1st |
  | `REVIEW_COST_CAP_USD` | 3 | That review (and its follow-ups) stops spending |
  | `MAX_REVIEWS_PER_DAY` | 8 | New reviews are refused until midnight |
  | `MAX_FOLLOWUPS_PER_REVIEW` | 20 | No more follow-up questions on that review |
  | `MAX_ANSWER_CHECKS_PER_HOUR` | 60 | Questionnaire answers pause for a bit |

  A new review is also refused if less than about $1.50 (a typical review) is left in today's or this month's budget. Today's and this month's spend are shown on the **Your reviews** page.
- **Hard backstop:** also set a monthly spend limit for your key in the Anthropic Console (Settings → Limits). That limit is enforced by Anthropic even if something here goes wrong.

## Reviewers

Profiles live in `src/experts/profiles/*.yaml`, following the schema in `src/core/expert.ts`. Each principle is a paraphrase linked to sources, with a confidence level. Short verbatim excerpts are included only where they were checked word for word. Only verified principles are used.

```bash
npm run kb:validate              # structure and references
npm run kb:validate -- --urls    # also check every source link
```

## Checks

```bash
npm run check   # typecheck, lint, unit + upload tests, design bans, profiles
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
| `src/server` | Database, storage, signed media URLs, jobs, review processing |
| `worker/` | Background worker loop |
| `data/` | Database, uploads, models (git-ignored) |
