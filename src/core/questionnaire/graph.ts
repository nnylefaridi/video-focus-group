import type { IntentFields, IntentKey } from "../intent";

export type ChoiceOption = {
  label: string;
  set: Partial<IntentFields>;
};

export type AnswerSpec =
  | {
      kind: "text";
      placeholder: string;
      /** Quick answers shown under the box once it is focused. Picking one fills it in. */
      suggestions?: string[];
    }
  | {
      kind: "choice";
      multi?: boolean;
      options: ChoiceOption[];
    };

export type QuestionNode = {
  id: string;
  prompt: string;
  helper?: string;
  /** Intent fields this question exists to resolve. If they are all known, the question is skipped. */
  fills: IntentKey[];
  answer: AnswerSpec;
  optional?: boolean;
  showIf?: (f: IntentFields) => boolean;
};

const isCreator = (f: IntentFields) => f.category === "creator";
const isAd = (f: IntentFields) => f.category === "ad";

export const QUESTIONS: QuestionNode[] = [
  {
    id: "what",
    prompt: "What's the video you're making?",
    fills: ["summary"],
    answer: {
      kind: "text",
      placeholder: "A 30-second skit about my cat judging my cooking…",
      suggestions: [
        "A comedy skit for TikTok",
        "A tutorial for my YouTube Shorts",
        "A day-in-my-life vlog for Reels",
        "A paid Instagram ad for my product",
      ],
    },
  },
  {
    id: "category",
    prompt: "Is this for your own channel, or an ad for something you sell?",
    fills: ["category"],
    showIf: (f) => !f.category,
    answer: {
      kind: "choice",
      options: [
        { label: "For my own channel", set: { category: "creator" } },
        { label: "An ad for a product or service", set: { category: "ad" } },
      ],
    },
  },

  // ── Creator path ───────────────────────────────────────────
  {
    id: "format",
    prompt: "What kind of video is it?",
    fills: ["format"],
    showIf: isCreator,
    answer: {
      kind: "choice",
      options: [
        { label: "Skit", set: { format: "skit" } },
        { label: "Talking to camera", set: { format: "talking_head" } },
        { label: "Explainer or tutorial", set: { format: "explainer" } },
        { label: "Vlog", set: { format: "vlog" } },
        { label: "POV", set: { format: "pov" } },
        { label: "Challenge or stunt", set: { format: "challenge" } },
        { label: "Something else", set: { format: "other" } },
      ],
    },
  },
  {
    id: "funny",
    prompt: "Is it meant to be funny?",
    fills: ["isComedy"],
    showIf: isCreator,
    answer: {
      kind: "choice",
      options: [
        { label: "Yes, it's comedy", set: { isComedy: true } },
        { label: "A little, but that's not the point", set: { isComedy: false } },
        { label: "No", set: { isComedy: false } },
      ],
    },
  },
  {
    id: "niche",
    prompt: "What's your niche, in your own words?",
    fills: ["niche"],
    showIf: isCreator,
    answer: { kind: "text", placeholder: "Cooking fails, pet comedy, budget travel…" },
  },
  {
    id: "audience",
    prompt: "Who do you picture watching this?",
    fills: ["audience"],
    showIf: isCreator,
    answer: { kind: "text", placeholder: "College students who cook badly, new cat owners…" },
  },
  {
    id: "reaction",
    prompt: "When it ends, what should a viewer do or feel?",
    helper: "Pick any that apply.",
    fills: ["reactions"],
    showIf: isCreator,
    answer: {
      kind: "choice",
      multi: true,
      options: [
        { label: "Laugh", set: { reactions: ["laugh"] } },
        { label: "Learn something", set: { reactions: ["learn"] } },
        { label: "Feel seen", set: { reactions: ["relate"] } },
        { label: "Send it to a friend", set: { reactions: ["share"] } },
        { label: "Follow me", set: { reactions: ["follow"] } },
      ],
    },
  },
  {
    id: "punchline",
    prompt: "Where is the big laugh supposed to land?",
    helper: "Describe the moment. It helps the panel judge your timing.",
    fills: ["punchline"],
    optional: true,
    showIf: (f) => isCreator(f) && f.isComedy === true,
    answer: { kind: "text", placeholder: "When the cat knocks the plate off the counter at the end…" },
  },
  {
    id: "takeaway",
    prompt: "What's the one thing a viewer should walk away knowing?",
    fills: ["takeaway"],
    optional: true,
    showIf: (f) => isCreator(f) && f.format === "explainer",
    answer: { kind: "text", placeholder: "That you can fix a squeaky hinge with a pencil." },
  },
  {
    id: "story",
    prompt: "What's the story of this one?",
    fills: ["story"],
    optional: true,
    showIf: (f) => isCreator(f) && f.format === "vlog",
    answer: { kind: "text", placeholder: "I tried to get to the airport on two dollars…" },
  },

  // ── Ad path ────────────────────────────────────────────────
  {
    id: "product",
    prompt: "What are you advertising?",
    fills: ["product", "offerType"],
    showIf: isAd,
    answer: { kind: "text", placeholder: "A vitamin C face serum, a budgeting app, a 6-week fitness program…" },
  },
  {
    id: "adAudience",
    prompt: "Who is it for?",
    fills: ["audience"],
    showIf: isAd,
    answer: { kind: "text", placeholder: "Women 25–40 who want clearer skin without a 10-step routine…" },
  },
  {
    id: "offer",
    prompt: "What's the offer? What do they get, and is there a deal?",
    fills: ["offer"],
    showIf: isAd,
    answer: { kind: "text", placeholder: "30-day supply, 20% off first order, free returns…" },
  },
  {
    id: "price",
    prompt: "Roughly what does it cost?",
    fills: ["pricePoint"],
    optional: true,
    showIf: isAd,
    answer: { kind: "text", placeholder: "$34, or $9/month…" },
  },
  {
    id: "goal",
    prompt: "What's this ad's job?",
    fills: ["goal"],
    showIf: isAd,
    answer: {
      kind: "choice",
      options: [
        { label: "Make people aware of us", set: { goal: "awareness" } },
        { label: "Get people considering us", set: { goal: "consideration" } },
        { label: "Get sales or sign-ups now", set: { goal: "conversion" } },
        { label: "Win back people who already looked", set: { goal: "retargeting" } },
      ],
    },
  },
  {
    id: "action",
    prompt: "What should someone do right after watching?",
    fills: ["desiredAction"],
    showIf: isAd,
    answer: { kind: "text", placeholder: "Tap Shop Now and order a trial size…" },
  },
  {
    id: "placement",
    prompt: "Where will it run?",
    fills: ["placement"],
    showIf: isAd,
    answer: {
      kind: "choice",
      options: [
        { label: "As a paid ad in the feed", set: { placement: "paid_feed" } },
        { label: "Organic, on our own account", set: { placement: "organic" } },
        { label: "Made to look like creator content", set: { placement: "ugc_style" } },
      ],
    },
  },
  {
    id: "brand",
    prompt: "How would you describe the brand's personality?",
    fills: ["brandPersonality"],
    optional: true,
    showIf: isAd,
    answer: { kind: "text", placeholder: "Calm, clinical, a little playful…" },
  },
  {
    id: "constraints",
    prompt: "Any claims or rules you have to stay within?",
    fills: ["constraints"],
    optional: true,
    showIf: isAd,
    answer: { kind: "text", placeholder: "Can't say 'cures', must show the disclaimer…" },
  },

  // ── Both ───────────────────────────────────────────────────
  {
    id: "platform",
    prompt: "Where will people see it?",
    helper: "Pick any that apply.",
    fills: ["platforms"],
    showIf: (f) => Boolean(f.category),
    answer: {
      kind: "choice",
      multi: true,
      options: [
        { label: "TikTok", set: { platforms: ["tiktok"] } },
        { label: "Instagram Reels", set: { platforms: ["reels"] } },
        { label: "YouTube Shorts", set: { platforms: ["shorts"] } },
        { label: "YouTube", set: { platforms: ["youtube"] } },
        { label: "LinkedIn", set: { platforms: ["linkedin"] } },
        { label: "X", set: { platforms: ["x"] } },
      ],
    },
  },
  {
    id: "stage",
    prompt: "Where's your account at right now?",
    fills: ["accountStage"],
    optional: true,
    showIf: isCreator,
    answer: {
      kind: "choice",
      options: [
        { label: "Just starting", set: { accountStage: "starting" } },
        { label: "Growing", set: { accountStage: "growing" } },
        { label: "Established", set: { accountStage: "established" } },
      ],
    },
  },
  {
    id: "unsure",
    prompt: "Anything you're unsure about in this video?",
    helper: "The panel will make sure to cover it.",
    fills: ["unsureAbout"],
    optional: true,
    showIf: (f) => Boolean(f.category),
    answer: { kind: "text", placeholder: "Whether the first two seconds are too slow…" },
  },
];

export const QUESTION_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
