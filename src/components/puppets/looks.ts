/** How each reviewer's paper puppet is drawn. Affectionate cartoon shorthand: signature hair, beard, accessories, outfit. */
export type HairStyle = "capLong" | "shortTextured" | "curly" | "messyGrey" | "swept" | "sidePart" | "buzz" | "balding" | "shortNeat";
export type Outfit = "tee" | "hoodie" | "jacket" | "blazer" | "shirt" | "suit";

export type Look = {
  skin: string;
  skinShade: string;
  hair: string;
  hairStyle: HairStyle;
  hairOutline?: string;
  beard?: "full" | "short" | "stubble";
  beardColor?: string;
  brows: "flat" | "raised" | "determined" | "soft";
  browColor?: string;
  mouth: "smile" | "grin" | "smirk" | "calm";
  outfit: Outfit;
  outfitColor: string;
  outfitShade: string;
  inner?: string;
  tie?: string;
  cap?: { color: string; shade: string };
  shades?: boolean;
  older?: boolean;
  /** What the hands are doing, as in a paper puppet's pose. */
  gesture: "open-right" | "open-left" | "point-right" | "point-left" | "both-open" | "crossed" | "none";
  /** Puppeteering rhythm when speaking. */
  wag: "a" | "b" | "c";
};

const LIGHT = { skin: "#F4D3BC", skinShade: "#DDAF92" };
const WARM = { skin: "#EDC3A1", skinShade: "#D29F7E" };
const TAN = { skin: "#E4B48F", skinShade: "#C68F6B" };

export const LOOKS: Record<string, Look> = {
  "alex-hormozi": {
    ...WARM, hair: "#2E2622", hairStyle: "capLong", beard: "full", beardColor: "#2E2622", brows: "determined",
    mouth: "smirk", outfit: "tee", outfitColor: "#41454C", outfitShade: "#33363C", cap: { color: "#2F3B57", shade: "#232D44" }, gesture: "open-right", wag: "c",
  },
  mrbeast: {
    ...LIGHT, hair: "#8C5B3A", hairStyle: "shortTextured", beard: "stubble", beardColor: "#6A4630", brows: "raised",
    mouth: "grin", outfit: "hoodie", outfitColor: "#283149", outfitShade: "#1E2537", gesture: "open-right", wag: "b",
  },
  "casey-neistat": {
    ...WARM, hair: "#3B2B22", hairStyle: "curly", brows: "flat", mouth: "smile", shades: true,
    outfit: "jacket", outfitColor: "#26282D", outfitShade: "#18191D", inner: "#34363C", gesture: "crossed", wag: "a",
  },
  "dan-harmon": {
    ...WARM, hair: "#80858B", hairStyle: "messyGrey", beard: "full", beardColor: "#8F9398", brows: "raised", browColor: "#6E7378",
    mouth: "smile", outfit: "shirt", outfitColor: "#45618C", outfitShade: "#36507A", older: true, gesture: "point-left", wag: "b",
  },
  "jerry-seinfeld": {
    ...LIGHT, hair: "#2F2723", hairStyle: "swept", brows: "raised", mouth: "smirk",
    outfit: "blazer", outfitColor: "#6D7581", outfitShade: "#58606B", inner: "#EAF0F5", gesture: "open-left", wag: "c",
  },
  "steve-martin": {
    ...LIGHT, hair: "#E8EAEC", hairOutline: "#C2C8CF", hairStyle: "swept", brows: "raised", browColor: "#B9BEC4",
    mouth: "grin", outfit: "suit", outfitColor: "#F3F2EE", outfitShade: "#D8DCE1", inner: "#DCE5EE", tie: "#9AA9BA", older: true, gesture: "both-open", wag: "a",
  },
  "mark-rober": {
    ...WARM, hair: "#4A3527", hairStyle: "sidePart", brows: "flat", mouth: "grin",
    outfit: "tee", outfitColor: "#3F6E9C", outfitShade: "#335C85", gesture: "point-right", wag: "b",
  },
  "gary-vaynerchuk": {
    ...TAN, hair: "#2B2522", hairStyle: "buzz", beard: "stubble", beardColor: "#2B2522", brows: "flat",
    mouth: "smirk", outfit: "hoodie", outfitColor: "#4A5650", outfitShade: "#3A443F", gesture: "open-left", wag: "c",
  },
  "david-ogilvy": {
    ...LIGHT, hair: "#B8BCC1", hairStyle: "balding", brows: "soft", browColor: "#A3A8AE", mouth: "calm",
    outfit: "suit", outfitColor: "#3C4454", outfitShade: "#2E3542", inner: "#F4F6F8", tie: "#8A4A4A", older: true, gesture: "none", wag: "a",
  },
  "donald-miller": {
    ...WARM, hair: "#6D5140", hairStyle: "shortNeat", beard: "short", beardColor: "#6D5140", brows: "soft", mouth: "smile",
    outfit: "blazer", outfitColor: "#405069", outfitShade: "#334057", inner: "#DCE7F2", gesture: "open-right", wag: "b",
  },
  "simon-sinek": {
    ...TAN, hair: "#2F2A27", hairStyle: "sidePart", brows: "soft", mouth: "smile",
    outfit: "shirt", outfitColor: "#323844", outfitShade: "#262B34", gesture: "point-left", wag: "a",
  },
  "russell-brunson": {
    ...LIGHT, hair: "#7B5B41", hairStyle: "shortNeat", brows: "raised", mouth: "grin",
    outfit: "blazer", outfitColor: "#5C6A79", outfitShade: "#4A5664", inner: "#FFFFFF", gesture: "open-right", wag: "c",
  },
};

export const FALLBACK_LOOK: Look = {
  ...WARM, hair: "#4A3B33", hairStyle: "shortNeat", brows: "soft", mouth: "smile", outfit: "tee", outfitColor: "#5C6B7A", outfitShade: "#4A5664", gesture: "none", wag: "a",
};

export function lookFor(id: string): Look {
  return LOOKS[id] ?? FALLBACK_LOOK;
}
