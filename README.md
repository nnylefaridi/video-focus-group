# Panel

Show a short video to a panel of AI reviewers modeled on well-known people in your field. The app opens straight on a question, recommends a board for your niche, and returns timestamped, evidence-backed feedback with a revision plan. Reviewers are AI interpretations built from each person's published work. They don't take part in or endorse any review.

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
5. **Character art (optional).** Until you run this, reviewers show as initials in their color. Add `OPENAI_API_KEY=` to `.env.local`, then:
   ```bash
   npm run art
   ```
   Check each character on its `/reviewers/<id>` page. Run `npm run art -- <id>` to redraw one.

## Run it

```bash
npm run dev
```

Open http://localhost:3000. This starts the web app and the background worker that processes videos. After changing `.env.local`, stop with Ctrl+C and start it again.

## How a review works

1. **Questions** adapt to what you're making. Your first free-text answer is read by Claude Haiku, which fills in what it can so you skip questions you've already answered. Every answer can be changed from the board screen.
2. **Board.** Three reviewers are picked for your niche and goal, including at least one pair who tend to disagree. You can swap, add or remove reviewers. Click any name to see their sourced ideas.
3. **Upload.** MP4, MOV or WebM, up to 3 minutes and 250 MB. The server checks the actual file contents (not the extension), then normalizes the video and strips its metadata.
4. **Evidence.** The worker detects cuts, samples frames (densely in the first 3 seconds), transcribes speech with word timings, and measures pauses, silence and sound without speech. Claude Sonnet then describes each frame. Every item gets an id like `F012`, `T03`, `S02` or `A01`.
5. **Review.** Each reviewer (Claude Opus with that person's profile) watches the evidence on their own and must cite evidence ids and their own principle ids. The model never writes timestamps; the app derives them from the cited evidence. Validators drop anything with no evidence, any made-up quote, or any prediction of views or sales.
6. **Panel.** The independent notes become a discussion with real disagreements, a comparison of where reviewers agree and differ, and a plan: *change these first*, *worth trying*, *keep these*.
7. **Ask.** Chat with any reviewer. They can take a closer look at any moment, re-sampling it at 8 frames per second.

Each review has a spending cap of $3 by default. Set `REVIEW_COST_CAP_USD` in `.env.local` to change it.

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
| `src/server` | Database, storage, signed media URLs, jobs, review processing |
| `worker/` | Background worker loop |
| `data/` | Database, uploads, models (git-ignored) |
