/**
 * How each reviewer's paper puppet is painted. Each one follows the person's real-life
 * likeness: head shape, how they hold their head, their typical expression, hair, beard,
 * glasses or cap, clothes and body language. Affectionate caricature, never mockery.
 */
export type HairStyle =
  | "capLong"
  | "quiff"
  | "curly"
  | "messyGrey"
  | "pompadour"
  | "silverBack"
  | "sidePart"
  | "buzz"
  | "balding"
  | "shortNeat"
  | "spiky";
export type Outfit = "tee" | "hoodie" | "jacket" | "blazer" | "shirt" | "suit";

export type Look = {
  skin: string;
  skinShade: string;
  /** Head size and jaw: rx/ry are half-width/half-height; jawY 0.35 square … 0.65 round; chin is the chin half-width. */
  head: { rx: number; ry: number; jawY: number; chin: number };
  /** Which way the face is turned (-1 left … 1 right) and how far the head tilts, in degrees. */
  turn: number;
  tilt: number;
  hair: string;
  hairStyle: HairStyle;
  beard?: "full" | "short" | "stubble";
  beardColor?: string;
  brows: "flat" | "raised" | "determined" | "soft" | "oneUp";
  browColor?: string;
  eyes: "round" | "narrow" | "happy" | "wide";
  mouth: "smile" | "grin" | "smirk" | "calm" | "talk" | "toothy";
  nose: "button" | "long" | "broad";
  outfit: Outfit;
  outfitColor: string;
  outfitShade: string;
  inner?: string;
  tie?: string;
  cap?: { color: string; shade: string };
  shades?: boolean;
  glasses?: boolean;
  older?: boolean;
  /** Shoulder width relative to normal (1). */
  build: number;
  /** What the hands are doing, as in a paper puppet's pose. */
  gesture: "open-right" | "open-left" | "point-right" | "point-left" | "both-open" | "crossed" | "none";
  /** Puppeteering rhythm when speaking. */
  wag: "a" | "b" | "c";
};

const LIGHT = { skin: "#F3D2BA", skinShade: "#D9A88A" };
const WARM = { skin: "#EBC09E", skinShade: "#CC9874" };
const TAN = { skin: "#E0AE88", skinShade: "#BF8962" };

export const LOOKS: Record<string, Look> = {
  // Broad, bearded, cap and long hair; intense squint, talking, palm out.
  "alex-hormozi": {
    ...WARM, head: { rx: 60, ry: 60, jawY: 0.42, chin: 26 }, turn: 0.45, tilt: 4,
    hair: "#2B211C", hairStyle: "capLong", beard: "full", beardColor: "#2B211C", brows: "determined", eyes: "narrow",
    mouth: "talk", nose: "broad", outfit: "tee", outfitColor: "#3E4147", outfitShade: "#2E3035",
    cap: { color: "#2C3A57", shade: "#1F2A42" }, build: 1.12, gesture: "open-right", wag: "c",
  },
  // Young, long-ish face, swept-up brown hair, short beard, huge excited grin.
  mrbeast: {
    ...LIGHT, head: { rx: 54, ry: 62, jawY: 0.5, chin: 18 }, turn: -0.2, tilt: -3,
    hair: "#8A5634", hairStyle: "quiff", beard: "short", beardColor: "#7A4C2E", brows: "raised", eyes: "wide",
    mouth: "toothy", nose: "button", outfit: "hoodie", outfitColor: "#26304A", outfitShade: "#1B2236", build: 1, gesture: "open-right", wag: "b",
  },
  // Narrow face, mop of curls, black sunglasses, smug smile, arms crossed, head cocked.
  "casey-neistat": {
    ...WARM, head: { rx: 52, ry: 60, jawY: 0.48, chin: 16 }, turn: 0.35, tilt: 8,
    hair: "#5A3A26", hairStyle: "curly", brows: "flat", eyes: "round", mouth: "smirk", nose: "long", shades: true,
    outfit: "jacket", outfitColor: "#24262B", outfitShade: "#16171A", inner: "#2F3136", build: 0.95, gesture: "crossed", wag: "a",
  },
  // Big round face, messy salt-and-pepper hair, full grey beard, finger up mid-theory.
  "dan-harmon": {
    ...WARM, head: { rx: 64, ry: 60, jawY: 0.58, chin: 30 }, turn: -0.3, tilt: -5,
    hair: "#7E8287", hairStyle: "messyGrey", beard: "full", beardColor: "#8C9095", brows: "raised", browColor: "#5F6468",
    eyes: "round", mouth: "smile", nose: "broad", outfit: "shirt", outfitColor: "#45618C", outfitShade: "#344C70", older: true, build: 1.15, gesture: "point-left", wag: "b",
  },
  // Long face, big dark swept hair, expressive brows, toothy wry grin, palms up.
  "jerry-seinfeld": {
    ...LIGHT, head: { rx: 53, ry: 66, jawY: 0.42, chin: 22 }, turn: 0.15, tilt: -4,
    hair: "#2E2622", hairStyle: "pompadour", brows: "raised", eyes: "round", mouth: "toothy", nose: "long",
    outfit: "blazer", outfitColor: "#6A7380", outfitShade: "#545C68", inner: "#E9EFF5", build: 1, gesture: "open-left", wag: "c",
  },
  // Long face, full white hair swept back, white suit, big showman grin, arms out.
  "steve-martin": {
    ...LIGHT, head: { rx: 52, ry: 65, jawY: 0.45, chin: 20 }, turn: -0.1, tilt: 3,
    hair: "#ECEDEE", hairStyle: "silverBack", brows: "raised", browColor: "#B4BAC0", eyes: "happy", mouth: "toothy", nose: "long",
    outfit: "suit", outfitColor: "#F2F1ED", outfitShade: "#D5D9DE", inner: "#DCE5EE", tie: "#9AA9BA", older: true, build: 0.95, gesture: "both-open", wag: "a",
  },
  // Round friendly face, short brown hair, big grin, blue tee, finger up with an idea.
  "mark-rober": {
    ...WARM, head: { rx: 59, ry: 58, jawY: 0.58, chin: 26 }, turn: 0.25, tilt: 2,
    hair: "#4A3527", hairStyle: "sidePart", brows: "raised", eyes: "happy", mouth: "toothy", nose: "button",
    outfit: "tee", outfitColor: "#3F6E9C", outfitShade: "#2F5880", build: 1, gesture: "point-right", wag: "b",
  },
  // Round head, very short dark hair, stubble, intense mid-sentence, palm out.
  "gary-vaynerchuk": {
    ...TAN, head: { rx: 60, ry: 58, jawY: 0.5, chin: 26 }, turn: -0.4, tilt: -2,
    hair: "#2A2421", hairStyle: "buzz", beard: "stubble", beardColor: "#2A2421", brows: "determined", eyes: "narrow",
    mouth: "talk", nose: "broad", outfit: "hoodie", outfitColor: "#454F49", outfitShade: "#343C37", build: 1.08, gesture: "open-left", wag: "c",
  },
  // Elderly, long face, bald crown with white sides, one eyebrow up, suit and tie.
  "david-ogilvy": {
    ...LIGHT, head: { rx: 52, ry: 64, jawY: 0.46, chin: 20 }, turn: 0.3, tilt: -2,
    hair: "#D7DADD", hairStyle: "balding", brows: "oneUp", browColor: "#9CA2A8", eyes: "round", mouth: "calm", nose: "long",
    outfit: "suit", outfitColor: "#38404F", outfitShade: "#2A303C", inner: "#F4F6F8", tie: "#8A4646", older: true, build: 0.95, gesture: "none", wag: "a",
  },
  // Round warm face, short brown hair, full trimmed beard, gentle smile, blazer.
  "donald-miller": {
    ...WARM, head: { rx: 58, ry: 60, jawY: 0.55, chin: 26 }, turn: -0.25, tilt: 3,
    hair: "#6B4F3D", hairStyle: "shortNeat", beard: "short", beardColor: "#6B4F3D", brows: "soft", eyes: "happy", mouth: "smile", nose: "button",
    outfit: "blazer", outfitColor: "#3F4F68", outfitShade: "#303D52", inner: "#DCE7F2", build: 1.05, gesture: "open-right", wag: "b",
  },
  // Oval face, dark hair brushed up, clean shaven, calm gentle smile, finger raised.
  "simon-sinek": {
    ...TAN, head: { rx: 54, ry: 62, jawY: 0.46, chin: 20 }, turn: 0.2, tilt: -6,
    hair: "#2C2724", hairStyle: "sidePart", brows: "soft", eyes: "round", mouth: "smile", nose: "long",
    outfit: "shirt", outfitColor: "#30363F", outfitShade: "#22272E", build: 0.95, gesture: "point-left", wag: "a",
  },
  // Boyish round face, short spiky brown hair, huge grin, blazer and white shirt.
  "russell-brunson": {
    ...LIGHT, head: { rx: 58, ry: 58, jawY: 0.58, chin: 24 }, turn: -0.15, tilt: 4,
    hair: "#7A5A40", hairStyle: "spiky", brows: "raised", eyes: "happy", mouth: "toothy", nose: "button",
    outfit: "blazer", outfitColor: "#5A6878", outfitShade: "#475463", inner: "#FFFFFF", build: 1, gesture: "open-right", wag: "c",
  },
};

export const FALLBACK_LOOK: Look = {
  ...WARM, head: { rx: 56, ry: 60, jawY: 0.5, chin: 22 }, turn: 0, tilt: 0, hair: "#4A3B33", hairStyle: "shortNeat",
  brows: "soft", eyes: "round", mouth: "smile", nose: "button", outfit: "tee", outfitColor: "#5C6B7A", outfitShade: "#4A5664", build: 1, gesture: "none", wag: "a",
};

export function lookFor(id: string): Look {
  return LOOKS[id] ?? FALLBACK_LOOK;
}
