import { z } from "zod";

/**
 * Structured "creator intent" built from questionnaire answers.
 * Every field is optional: the flow only asks what is relevant,
 * and the interpreter only fills what it is confident about.
 */
export const Category = z.enum(["creator", "ad"]);
export type Category = z.infer<typeof Category>;

export const CreatorFormat = z.enum([
  "skit",
  "talking_head",
  "explainer",
  "vlog",
  "pov",
  "challenge",
  "other",
]);
export type CreatorFormat = z.infer<typeof CreatorFormat>;

export const AdGoal = z.enum(["awareness", "consideration", "conversion", "retargeting"]);
export const AdPlacement = z.enum(["paid_feed", "organic", "ugc_style"]);
export const AdOfferType = z.enum(["physical_product", "app_or_software", "service", "course_or_coaching", "other"]);
export const Reaction = z.enum(["laugh", "learn", "relate", "share", "follow", "buy", "remember_brand"]);
export const Platform = z.enum(["tiktok", "reels", "shorts", "youtube", "linkedin", "x", "other"]);

export const IntentFields = z.object({
  category: Category.optional(),
  summary: z.string().optional(),
  platforms: z.array(Platform).optional(),
  // creator
  format: CreatorFormat.optional(),
  isComedy: z.boolean().optional(),
  niche: z.string().optional(),
  audience: z.string().optional(),
  reactions: z.array(Reaction).optional(),
  punchline: z.string().optional(),
  takeaway: z.string().optional(),
  story: z.string().optional(),
  accountStage: z.enum(["starting", "growing", "established"]).optional(),
  // ad
  product: z.string().optional(),
  offerType: AdOfferType.optional(),
  offer: z.string().optional(),
  pricePoint: z.string().optional(),
  brandPersonality: z.string().optional(),
  goal: AdGoal.optional(),
  desiredAction: z.string().optional(),
  placement: AdPlacement.optional(),
  constraints: z.string().optional(),
  // both
  unsureAbout: z.string().optional(),
});
export type IntentFields = z.infer<typeof IntentFields>;
export type IntentKey = keyof IntentFields;
