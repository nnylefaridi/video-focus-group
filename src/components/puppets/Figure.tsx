import { useId } from "react";
import type { Look } from "./looks";

/**
 * A reviewer drawn as a squishy cartoon paper cutout: dark line art, big soft
 * head, chunky shaded hair, and arms with an expressive hand gesture.
 * The white cutout edge comes from one SVG filter that dilates the silhouette.
 * Coordinates are in a 200-wide space centred on x=100; the full view widens to
 * fit gesturing hands. "head" crops to the face for small avatars.
 */
export const FIGURE_VIEWBOX = { x: -30, y: -10, w: 260, h: 270 };
export const FIGURE_ASPECT = FIGURE_VIEWBOX.h / FIGURE_VIEWBOX.w;

const INK = "#33292A";
const SW = 3.4;

function darken(hex: string, amt = 0.22): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.round(((n >> s) & 255) * (1 - amt)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

export function Figure({ look, crop = "full", className, title }: { look: Look; crop?: "full" | "head"; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const v = FIGURE_VIEWBOX;
  const viewBox = crop === "head" ? "16 2 168 174" : `${v.x} ${v.y} ${v.w} ${v.h}`;

  return (
    <svg viewBox={viewBox} className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <filter id={`cut-${id}`} x="-15%" y="-15%" width="130%" height="130%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="6" result="grown" />
          <feFlood floodColor="#ffffff" />
          <feComposite in2="grown" operator="in" result="edge" />
          <feMerge>
            <feMergeNode in="edge" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id={`clip-${id}`}>
          {crop === "head" ? <rect x="10" y="-4" width="180" height="186" rx="30" /> : <rect x={v.x} y={v.y} width={v.w} height={252} />}
        </clipPath>
      </defs>
      <g filter={`url(#cut-${id})`}>
        <g clipPath={`url(#clip-${id})`} stroke={INK} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round">
          <HairBack look={look} />
          <path d="M86 138 L86 180 Q100 188 114 180 L114 138 Z" fill={look.skinShade} />
          <Body look={look} />
          {crop === "full" && <Arms look={look} />}
          {/* ears */}
          <circle cx="40" cy="97" r="13" fill={look.skin} />
          <circle cx="160" cy="97" r="13" fill={look.skin} />
          <path d="M36 92 Q44 97 38 104" stroke={look.skinShade} strokeWidth="3" fill="none" />
          <path d="M164 92 Q156 97 162 104" stroke={look.skinShade} strokeWidth="3" fill="none" />
          {/* head: big, soft and slightly squarish at the jaw */}
          <path d="M100 24 C142 24 163 50 163 90 C163 128 140 156 100 156 C60 156 37 128 37 90 C37 50 58 24 100 24 Z" fill={look.skin} />
          <path d="M60 140 C76 152 124 152 140 140 C128 156 72 156 60 140 Z" fill={look.skinShade} stroke="none" opacity="0.5" />
          <Beard look={look} />
          <Hair look={look} />
          <Face look={look} />
        </g>
      </g>
    </svg>
  );
}

function HairBack({ look }: { look: Look }) {
  if (look.hairStyle !== "capLong") return null;
  return (
    <g fill={look.hair}>
      <path d="M44 78 C28 118 26 172 38 204 L78 198 C62 164 58 124 62 96 Z" />
      <path d="M156 78 C172 118 174 172 162 204 L122 198 C138 164 142 124 138 96 Z" />
      <path d="M44 120 C42 150 46 176 52 196 M156 120 C158 150 154 176 148 196" stroke={darken(look.hair, 0.4)} strokeWidth="2.5" fill="none" />
    </g>
  );
}

function Body({ look }: { look: Look }) {
  const { outfit, outfitColor: c, outfitShade: s } = look;
  const light = "#EEF1F4";
  return (
    <g>
      <path d="M16 262 C16 206 50 174 100 172 C150 174 184 206 184 262 Z" fill={c} />
      {/* soft shading down one side, the way the cutouts are painted */}
      <path d="M142 186 C166 198 180 224 184 262 L152 262 C154 230 150 206 142 186 Z" fill={s} stroke="none" opacity="0.7" />
      {outfit === "tee" && <path d="M80 175 Q100 193 120 175" fill="none" />}
      {outfit === "hoodie" && (
        <>
          <path d="M56 188 Q100 150 144 188 Q130 208 100 210 Q70 208 56 188 Z" fill={s} />
          <path d="M78 186 Q100 200 122 186" fill="none" />
          <path d="M90 204 L88 232 M110 204 L112 232" stroke={light} strokeWidth="3.5" />
          <circle cx="88" cy="235" r="3.5" fill={light} strokeWidth="2" />
          <circle cx="112" cy="235" r="3.5" fill={light} strokeWidth="2" />
          <path d="M70 246 Q100 236 130 246" fill="none" stroke={s} strokeWidth="3" />
        </>
      )}
      {(outfit === "jacket" || outfit === "blazer" || outfit === "suit") && (
        <>
          <path d="M80 172 L100 222 L120 172 Z" fill={look.inner ?? s} />
          {look.tie && <path d="M95 180 L105 180 L108 214 L100 226 L92 214 Z" fill={look.tie} />}
          <path d="M80 172 L100 222 L72 214 L60 186 Z" fill={s} />
          <path d="M120 172 L100 222 L128 214 L140 186 Z" fill={s} />
          {outfit === "jacket" && <path d="M100 222 L100 262" fill="none" />}
          {outfit !== "jacket" && <circle cx="100" cy="240" r="3.2" fill={s} />}
        </>
      )}
      {outfit === "shirt" && (
        <>
          <path d="M100 178 L100 262" fill="none" stroke={s} strokeWidth="3" />
          <path d="M78 170 L92 192 L100 178 L108 192 L122 170 Q100 180 78 170 Z" fill={s} />
          {[202, 220, 238].map((y) => (
            <circle key={y} cx="100" cy={y} r="3" fill={light} strokeWidth="1.8" />
          ))}
          <path d="M136 214 L150 214 L150 228 L136 228 Z" fill={s} strokeWidth="2.4" />
        </>
      )}
    </g>
  );
}

/** A cartoon hand, palm out, fingers up. Local origin is the middle of the palm. */
function OpenHand({ skin, x, y, rot }: { skin: string; x: number; y: number; rot: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} fill={skin} strokeWidth="2.8">
      <rect x="-14" y="-34" width="7.5" height="24" rx="3.75" />
      <rect x="-6.5" y="-39" width="7.5" height="29" rx="3.75" />
      <rect x="1" y="-38" width="7.5" height="28" rx="3.75" />
      <rect x="8.5" y="-31" width="7" height="21" rx="3.5" />
      <rect x="-27" y="-13" width="17" height="8" rx="4" transform="rotate(-28 -14 -9)" />
      <path d="M-15 -14 C-15 -24 16 -24 16 -14 L15 4 C13 13 -13 13 -15 4 Z" />
    </g>
  );
}

/** A hand with the index finger raised to make a point. */
function PointHand({ skin, x, y, rot }: { skin: string; x: number; y: number; rot: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} fill={skin} strokeWidth="2.8">
      <rect x="-4" y="-44" width="8.5" height="34" rx="4.25" />
      <rect x="-14" y="-18" width="28" height="28" rx="11" />
      <path d="M-11 -6 L9 -6 M-11 2 L9 2" fill="none" strokeWidth="2" />
      <path d="M-14 -2 Q-4 -10 6 -4" fill="none" strokeWidth="2.4" />
    </g>
  );
}

function ArmTube({ d, color }: { d: string; color: string }) {
  return (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth="31" />
      <path d={d} fill="none" stroke={color} strokeWidth="24" />
    </>
  );
}

/** One gesturing arm on the viewer's right; mirrored for the left. */
function RightArm({ look, kind }: { look: Look; kind: "open" | "point" }) {
  const bare = look.outfit === "tee";
  return (
    <g>
      {bare ? (
        <>
          <ArmTube d="M150 214 Q190 218 194 176" color={look.skin} />
          <ArmTube d="M150 214 Q176 214 184 202" color={look.outfitColor} />
        </>
      ) : (
        <ArmTube d="M150 214 Q190 218 194 178" color={look.outfitColor} />
      )}
      {!bare && <path d="M184 182 L204 182" stroke={INK} strokeWidth="2.6" />}
      {kind === "open" ? <OpenHand skin={look.skin} x={196} y={160} rot={10} /> : <PointHand skin={look.skin} x={194} y={164} rot={4} />}
    </g>
  );
}

function Arms({ look }: { look: Look }) {
  const mirror = "translate(200 0) scale(-1 1)";
  switch (look.gesture) {
    case "open-right":
      return <RightArm look={look} kind="open" />;
    case "open-left":
      return (
        <g transform={mirror}>
          <RightArm look={look} kind="open" />
        </g>
      );
    case "point-right":
      return <RightArm look={look} kind="point" />;
    case "point-left":
      return (
        <g transform={mirror}>
          <RightArm look={look} kind="point" />
        </g>
      );
    case "both-open":
      return (
        <>
          <RightArm look={look} kind="open" />
          <g transform={mirror}>
            <RightArm look={look} kind="open" />
          </g>
        </>
      );
    case "crossed":
      return (
        <g>
          <ArmTube d="M44 238 Q100 210 156 230" color={look.outfitShade} />
          <ArmTube d="M156 244 Q100 222 46 232" color={look.outfitColor} />
          <circle cx="150" cy="229" r="9" fill={look.skin} strokeWidth="2.6" />
          <circle cx="51" cy="231" r="9" fill={look.skin} strokeWidth="2.6" />
        </g>
      );
    default:
      return null;
  }
}

function Hair({ look }: { look: Look }) {
  const h = look.hair;
  const strand = { stroke: look.hairOutline ?? darken(h, 0.35), strokeWidth: 2.6, fill: "none" };
  switch (look.hairStyle) {
    case "capLong":
      return (
        <g>
          <path d="M40 86 C38 42 64 18 100 18 C136 18 162 42 160 86 Z" fill={look.cap!.color} />
          <path d="M100 18 L100 84" fill="none" stroke={look.cap!.shade} strokeWidth="2.4" />
          <path d="M128 26 C146 36 156 56 158 82 L142 84 C142 60 136 40 128 26 Z" fill={look.cap!.shade} stroke="none" opacity="0.6" />
          <path d="M30 84 C70 66 144 66 180 88 C182 97 172 101 162 99 C132 90 76 90 38 96 C30 94 28 88 30 84 Z" fill={look.cap!.shade} />
          <path d="M83 58 L92 47 L99 55 L107 45 L118 58" stroke="#FFFFFF" strokeWidth="3.6" fill="none" />
          <path d="M40 96 C38 112 41 122 46 130 M160 96 C162 112 159 122 154 130" fill="none" stroke={h} strokeWidth="11" />
        </g>
      );
    case "shortTextured":
      return (
        <g>
          <path
            d="M38 96 C32 50 60 20 102 20 C146 22 168 54 162 96 C158 78 152 66 143 60 C134 68 120 62 114 54 C106 64 90 62 84 54 C76 64 62 64 55 67 C47 75 42 84 38 96 Z"
            fill={h}
          />
          <path d="M98 22 C102 6 120 4 128 12 C118 14 112 18 110 26 Z" fill={h} />
          <path d="M60 46 C72 36 84 32 96 32 M112 32 C128 34 142 42 150 54" {...strand} />
        </g>
      );
    case "curly": {
      const curls: [number, number, number][] = [
        [44, 78, 15], [50, 54, 16], [64, 35, 16], [85, 24, 16], [108, 22, 16], [130, 29, 16], [148, 45, 16], [157, 70, 15],
        [70, 54, 14], [92, 44, 14], [114, 44, 14], [135, 56, 13],
      ];
      return (
        <g fill={h}>
          <path d="M42 90 C38 42 68 20 100 20 C132 20 162 42 158 90 C150 66 130 58 100 58 C70 58 50 66 42 90 Z" />
          {curls.map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} />
          ))}
          {curls.slice(0, 8).map(([cx, cy], i) => (
            <path key={`c${i}`} d={`M${cx - 6} ${cy + 2} q6 -7 12 0`} {...strand} />
          ))}
        </g>
      );
    }
    case "messyGrey":
      return (
        <g>
          <path
            d="M38 96 C30 56 54 22 98 20 C148 18 172 52 162 96 C160 80 154 72 147 67 C153 56 143 48 135 52 C131 40 114 42 110 50 C100 38 84 44 82 54 C70 50 58 56 62 66 C50 68 43 80 38 96 Z"
            fill={h}
          />
          <path d="M68 40 C78 32 90 32 98 36 M114 32 C126 32 138 38 144 48 M56 70 C60 62 66 58 74 58" stroke="#B4B9BE" strokeWidth="3" fill="none" />
        </g>
      );
    case "swept":
      return (
        <g fill={h}>
          <path d="M40 92 C34 48 62 16 104 16 C147 16 170 46 160 86 C151 66 132 60 112 60 C96 60 84 56 78 46 C72 56 56 68 40 92 Z" />
          <path d="M64 42 C86 28 120 26 146 40 M84 52 C104 44 128 44 150 56" {...strand} />
        </g>
      );
    case "sidePart":
      return (
        <g>
          <path d="M38 94 C34 50 62 20 100 20 C140 20 166 48 162 94 C156 74 146 62 134 58 C112 64 86 60 70 50 C58 60 46 74 38 94 Z" fill={h} />
          <path d="M70 50 C84 40 100 32 118 30 M120 40 C134 42 146 50 152 60" {...strand} />
        </g>
      );
    case "buzz":
      return (
        <g>
          <path d="M42 88 C40 44 66 22 100 22 C134 22 160 44 158 88 C152 64 138 54 100 52 C62 54 48 64 42 88 Z" fill={h} />
          <path d="M64 36 L66 40 M80 30 L81 34 M98 28 L98 32 M116 29 L115 33 M132 34 L130 38" {...strand} />
        </g>
      );
    case "balding":
      return (
        <g fill={h}>
          <path d="M38 102 C34 78 40 62 54 52 C52 70 52 88 56 104 Z" />
          <path d="M162 102 C166 78 160 62 146 52 C148 70 148 88 144 104 Z" />
          <path d="M82 32 C94 26 108 26 120 31" fill="none" strokeWidth="3" />
        </g>
      );
    case "shortNeat":
    default:
      return (
        <g>
          <path d="M38 92 C34 46 62 20 100 20 C138 20 166 46 162 92 C158 74 146 62 134 58 C120 50 80 50 66 58 C54 64 42 76 38 92 Z" fill={h} />
          <path d="M66 40 C80 32 96 30 110 30 M120 32 C134 36 146 44 152 56" {...strand} />
        </g>
      );
  }
}

function Beard({ look }: { look: Look }) {
  if (!look.beard) return null;
  const c = look.beardColor ?? look.hair;
  const tex = { stroke: darken(c, 0.35), strokeWidth: 2.4, fill: "none" };
  const mustache = <path d="M74 124 C85 112 96 115 100 119 C104 115 115 112 126 124 C113 128 104 126 100 126 C96 126 87 128 74 124 Z" fill={c} />;
  if (look.beard === "full")
    return (
      <g>
        <path d="M37 92 C37 146 62 172 100 174 C138 172 163 146 163 92 C157 116 143 130 128 132 C118 122 82 122 72 132 C57 130 43 116 37 92 Z" fill={c} />
        <path d="M60 140 l4 6 M82 152 l2 6 M100 156 l0 7 M118 152 l-2 6 M140 140 l-4 6" {...tex} />
        {mustache}
      </g>
    );
  const shape = (
    <path d="M46 106 C50 148 74 164 100 166 C126 164 150 148 154 106 C147 126 134 136 124 136 C116 127 84 127 76 136 C66 136 53 126 46 106 Z" fill={c} />
  );
  if (look.beard === "stubble") return <g opacity="0.24" stroke="none">{shape}</g>;
  return (
    <g>
      {shape}
      <path d="M70 146 l3 5 M100 158 l0 6 M130 146 l-3 5" {...tex} />
      {mustache}
    </g>
  );
}

function Face({ look }: { look: Look }) {
  const brow = look.browColor ?? (look.hairStyle === "balding" ? darken(look.hair, 0.25) : darken(look.hair, 0.15));
  const browPaths = {
    flat: ["M68 81 Q80 76 92 80", "M108 80 Q120 76 132 81"],
    raised: ["M67 76 Q80 67 93 75", "M107 75 Q120 67 133 76"],
    determined: ["M68 76 L92 84", "M132 76 L108 84"],
    soft: ["M69 80 Q80 74 91 78", "M109 78 Q120 74 131 80"],
  }[look.brows];
  return (
    <g>
      {browPaths.map((d, i) => (
        <path key={i} d={d} stroke={brow} strokeWidth="6.5" fill="none" />
      ))}
      {look.shades ? (
        <g>
          <rect x="60" y="85" width="37" height="24" rx="10" fill="#1E2126" />
          <rect x="103" y="85" width="37" height="24" rx="10" fill="#1E2126" />
          <path d="M97 93 Q100 90 103 93" fill="none" strokeWidth="4" />
          <path d="M67 92 L77 92 M110 92 L120 92" stroke="#FFFFFF" strokeWidth="3" opacity="0.75" />
        </g>
      ) : (
        <g stroke="none">
          <ellipse cx="80" cy="98" rx="7.6" ry="10" fill={INK} />
          <ellipse cx="120" cy="98" rx="7.6" ry="10" fill={INK} />
          <circle cx="82.8" cy="94" r="3" fill="#FFFFFF" />
          <circle cx="122.8" cy="94" r="3" fill="#FFFFFF" />
        </g>
      )}
      {look.older && <path d="M58 108 Q63 113 60 118 M142 108 Q137 113 140 118" stroke={look.skinShade} strokeWidth="3" fill="none" />}
      <g stroke="none">
        <ellipse cx="66" cy="117" rx="9" ry="6.5" fill="#EE918A" opacity="0.42" />
        <ellipse cx="134" cy="117" rx="9" ry="6.5" fill="#EE918A" opacity="0.42" />
      </g>
      <path d="M100 103 Q109 110 100 115" fill="none" strokeWidth="3" />
      {look.mouth === "grin" && (
        <g>
          <path d="M82 124 Q100 152 118 124 Z" fill="#5E2A2A" />
          <path d="M85 125.5 L115 125.5 L113 131 L87 131 Z" fill="#FFFFFF" stroke="none" />
          <path d="M91 139 Q100 133 109 139 Q100 147 91 139 Z" fill="#E07C7C" stroke="none" />
        </g>
      )}
      {look.mouth === "smile" && <path d="M86 127 Q100 140 114 127" fill="none" strokeWidth="4" />}
      {look.mouth === "smirk" && <path d="M88 131 Q103 137 114 125" fill="none" strokeWidth="4" />}
      {look.mouth === "calm" && <path d="M90 131 Q100 135 110 131" fill="none" strokeWidth="4" />}
    </g>
  );
}
