import { useId } from "react";
import type { Look } from "./looks";

/**
 * A reviewer painted as a paper cutout: soft gradient shading, warm brown linework,
 * a faint paper grain, and a white cutout edge. Head shape, turn, tilt, expression,
 * hair and pose all come from the person's likeness (see looks.ts).
 * Coordinates are in a 200-wide space centred on x=100; the full view widens to fit
 * gesturing hands. "head" crops to the face for small avatars.
 */
export const FIGURE_VIEWBOX = { x: -30, y: -10, w: 260, h: 270 };
export const FIGURE_ASPECT = FIGURE_VIEWBOX.h / FIGURE_VIEWBOX.w;

const INK = "#3B2A23";
const SW = 2.8;
const CY = 92; // head centre

function shade(hex: string, amt: number): string {
  // amt > 0 lightens toward white, amt < 0 darkens toward black.
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => {
    const c = (n >> s) & 255;
    return Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

function headPath(l: Look): string {
  const { rx, ry, jawY, chin } = l.head;
  const L = 100 - rx, R = 100 + rx, T = CY - ry, B = CY + ry;
  return `M${L} ${CY} C${L} ${CY - ry * 0.56} ${100 - rx * 0.56} ${T} 100 ${T} C${100 + rx * 0.56} ${T} ${R} ${CY - ry * 0.56} ${R} ${CY} C${R} ${CY + ry * jawY} ${100 + chin} ${B} 100 ${B} C${100 - chin} ${B} ${L} ${CY + ry * jawY} ${L} ${CY} Z`;
}

/** Points around the top of the head, for curls, tufts and spikes. */
function crown(l: Look, from: number, to: number, n: number, scale = 1.04): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((from + ((to - from) * i) / (n - 1)) * Math.PI) / 180;
    pts.push([100 + Math.cos(a) * l.head.rx * scale, CY + Math.sin(a) * l.head.ry * scale]);
  }
  return pts;
}

type Mass = {
  /** Extra height above the skull (px). */
  vol: number;
  /** Bumps along the outer edge and how big they are. */
  lumps: number;
  bump: number;
  /** A swoop of extra volume centred on this angle (deg, 270 = top, 300 = front-right). */
  swoop?: { at: number; h: number };
  /** Hairline height above the brows: 0 low … 1 high (receding). */
  hairline: number;
  /** Where the parting/peak sits, as an x offset from centre. */
  part: number;
  sharp?: boolean;
};

/** Hair as a mass sitting on the head: volume above the skull, textured edge, exposed forehead. */
function hairMass(l: Look, m: Mass): string {
  const { rx, ry } = l.head;
  const L = 100 - rx, R = 100 + rx, T = CY - ry;
  const n = m.lumps * 2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = 196 + (148 * i) / n;
    const rad = (a * Math.PI) / 180;
    const sw = m.swoop ? m.swoop.h * Math.exp(-(((a - m.swoop.at) / 48) ** 2)) : 0;
    const out = i % 2 === 0 ? 0 : m.bump;
    const kx = rx * 1.06 + out * 0.5;
    const ky = ry * 1.02 + m.vol * Math.max(0, -Math.sin(rad)) + sw + out;
    pts.push([100 + Math.cos(rad) * kx, CY + Math.sin(rad) * ky]);
  }
  const hy = T + ry * (0.3 + m.hairline * 0.28); // hairline at the middle of the forehead
  let d = `M${L + 7} ${CY - 2} L${L - 2} ${CY - 18}`;
  for (let i = 1; i < pts.length; i += 2) {
    const [cx, cy] = pts[i];
    const [x, y] = pts[i + 1] ?? pts[i];
    d += m.sharp ? ` L${cx.toFixed(1)} ${cy.toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)}` : ` Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L${R + 2} ${CY - 18} L${R - 7} ${CY - 2}`;
  // sideburn down, then the hairline back across the forehead with a soft peak at the part
  d += ` C${R - 9} ${CY - 18} ${R - 12} ${hy + 10} ${100 + m.part + 18} ${hy + 4} Q${100 + m.part} ${hy + 10} ${100 + m.part - 18} ${hy + 3}`;
  d += ` C${L + 12} ${hy + 10} ${L + 9} ${CY - 18} ${L + 7} ${CY - 2} Z`;
  return d;
}

export function Figure({ look, crop = "full", className, title }: { look: Look; crop?: "full" | "head"; className?: string; title?: string }) {
  const uid = useId().replace(/:/g, "");
  const v = FIGURE_VIEWBOX;
  const viewBox = crop === "head" ? "14 0 172 176" : `${v.x} ${v.y} ${v.w} ${v.h}`;
  const id = (k: string) => `${k}-${uid}`;
  const url = (k: string) => `url(#${id(k)})`;

  return (
    <svg viewBox={viewBox} className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        {/* white paper cutout edge + a faint paper grain over the painting */}
        <filter id={id("cut")} x="-15%" y="-15%" width="130%" height="130%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="6" result="grown" />
          <feFlood floodColor="#ffffff" />
          <feComposite in2="grown" operator="in" result="edge" />
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.22  0 0 0 0.09 0" result="tint" />
          <feComposite in="tint" in2="SourceAlpha" operator="in" result="grain" />
          <feMerge>
            <feMergeNode in="edge" />
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="grain" />
          </feMerge>
        </filter>
        <filter id={id("soft")} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <radialGradient id={id("skin")} cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor={shade(look.skin, 0.18)} />
          <stop offset="55%" stopColor={look.skin} />
          <stop offset="100%" stopColor={shade(look.skinShade, -0.04)} />
        </radialGradient>
        <linearGradient id={id("hair")} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={shade(look.hair, 0.16)} />
          <stop offset="50%" stopColor={look.hair} />
          <stop offset="100%" stopColor={shade(look.hair, -0.28)} />
        </linearGradient>
        <linearGradient id={id("beard")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={shade(look.beardColor ?? look.hair, 0.1)} />
          <stop offset="100%" stopColor={shade(look.beardColor ?? look.hair, -0.25)} />
        </linearGradient>
        <linearGradient id={id("cloth")} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0%" stopColor={shade(look.outfitColor, 0.12)} />
          <stop offset="60%" stopColor={look.outfitColor} />
          <stop offset="100%" stopColor={look.outfitShade} />
        </linearGradient>
        <clipPath id={id("head")}>
          <path d={headPath(look)} />
        </clipPath>
        <clipPath id={id("frame")}>
          {crop === "head" ? <rect x="10" y="-4" width="180" height="186" rx="30" /> : <rect x={v.x} y={v.y} width={v.w} height={252} />}
        </clipPath>
      </defs>
      <g filter={url("cut")}>
        <g clipPath={url("frame")} stroke={INK} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round">
          {look.hairStyle === "capLong" && <LongHairBack look={look} fill={url("hair")} />}
          {/* neck with a soft shadow under the jaw */}
          <path d={`M86 ${CY + look.head.ry - 18} L86 182 Q100 190 114 182 L114 ${CY + look.head.ry - 18} Z`} fill={look.skinShade} />
          <Body look={look} cloth={url("cloth")} />
          {crop === "full" && <Arms look={look} />}
          <g transform={`rotate(${look.tilt} 100 ${CY + look.head.ry})`}>
            <Ears look={look} skin={url("skin")} />
            <path d={headPath(look)} fill={url("skin")} />
            {/* painted shading: shadow under the hairline, the turned-away cheek, and blush */}
            <g clipPath={url("head")} stroke="none" filter={url("soft")}>
              <ellipse cx={100} cy={CY - look.head.ry * 0.55} rx={look.head.rx * 0.95} ry={look.head.ry * 0.2} fill={look.skinShade} opacity="0.55" />
              <ellipse cx={100 - look.turn * look.head.rx * 0.95} cy={CY + 8} rx={look.head.rx * 0.32} ry={look.head.ry * 0.85} fill={look.skinShade} opacity="0.5" />
              <ellipse cx={100} cy={CY + look.head.ry * 0.95} rx={look.head.rx * 0.7} ry={look.head.ry * 0.16} fill={look.skinShade} opacity="0.5" />
            </g>
            <Beard look={look} fill={url("beard")} />
            <Hair look={look} fill={url("hair")} clipId={id("hairclip")} />
            <Face look={look} soft={url("soft")} />
          </g>
        </g>
      </g>
    </svg>
  );
}

function Ears({ look, skin }: { look: Look; skin: string }) {
  const { rx } = look.head;
  const showL = look.turn > -0.38;
  const showR = look.turn < 0.38;
  return (
    <g fill={skin}>
      {showL && (
        <>
          <ellipse cx={100 - rx + 1} cy={CY + 6} rx={11} ry={13.5} />
          <path d={`M${100 - rx - 3} ${CY + 1} Q${100 - rx + 4} ${CY + 6} ${100 - rx - 1} ${CY + 12}`} fill="none" stroke={look.skinShade} strokeWidth="2.6" />
        </>
      )}
      {showR && (
        <>
          <ellipse cx={100 + rx - 1} cy={CY + 6} rx={11} ry={13.5} />
          <path d={`M${100 + rx + 3} ${CY + 1} Q${100 + rx - 4} ${CY + 6} ${100 + rx + 1} ${CY + 12}`} fill="none" stroke={look.skinShade} strokeWidth="2.6" />
        </>
      )}
    </g>
  );
}

function LongHairBack({ look, fill }: { look: Look; fill: string }) {
  const L = 100 - look.head.rx, R = 100 + look.head.rx;
  const strand = shade(look.hair, -0.45);
  return (
    <g fill={fill}>
      <path d={`M${L + 6} ${CY - 12} C${L - 14} ${CY + 30} ${L - 18} ${CY + 84} ${L - 6} ${CY + 116} C${L + 6} ${CY + 122} ${L + 26} ${CY + 118} ${L + 38} ${CY + 108} C${L + 22} ${CY + 72} ${L + 18} ${CY + 30} ${L + 24} ${CY} Z`} />
      <path d={`M${R - 6} ${CY - 12} C${R + 14} ${CY + 30} ${R + 18} ${CY + 84} ${R + 6} ${CY + 116} C${R - 6} ${CY + 122} ${R - 26} ${CY + 118} ${R - 38} ${CY + 108} C${R - 22} ${CY + 72} ${R - 18} ${CY + 30} ${R - 24} ${CY} Z`} />
      <path d={`M${L - 4} ${CY + 40} C${L - 6} ${CY + 70} ${L} ${CY + 96} ${L + 8} ${CY + 112} M${R + 4} ${CY + 40} C${R + 6} ${CY + 70} ${R} ${CY + 96} ${R - 8} ${CY + 112}`} fill="none" stroke={strand} strokeWidth="2.2" />
    </g>
  );
}

function Body({ look, cloth }: { look: Look; cloth: string }) {
  const b = look.build;
  const { outfit, outfitShade: s } = look;
  const light = "#EEF1F4";
  return (
    <g>
      <path d={`M${100 - 84 * b} 262 C${100 - 84 * b} 206 ${100 - 50 * b} 176 100 174 C${100 + 50 * b} 176 ${100 + 84 * b} 206 ${100 + 84 * b} 262 Z`} fill={cloth} />
      {outfit === "tee" && <path d="M80 176 Q100 194 120 176" fill="none" />}
      {outfit === "hoodie" && (
        <>
          <path d="M56 190 Q100 152 144 190 Q130 210 100 212 Q70 210 56 190 Z" fill={s} />
          <path d="M78 188 Q100 202 122 188" fill="none" />
          <path d="M90 206 L88 234 M110 206 L112 234" stroke={light} strokeWidth="3.4" />
          <circle cx="88" cy="237" r="3.4" fill={light} strokeWidth="1.8" />
          <circle cx="112" cy="237" r="3.4" fill={light} strokeWidth="1.8" />
        </>
      )}
      {(outfit === "jacket" || outfit === "blazer" || outfit === "suit") && (
        <>
          <path d="M80 174 L100 224 L120 174 Z" fill={look.inner ?? s} />
          {look.tie && <path d="M95 182 L105 182 L108 216 L100 228 L92 216 Z" fill={look.tie} />}
          <path d="M80 174 L100 224 L70 216 L58 188 Z" fill={s} />
          <path d="M120 174 L100 224 L130 216 L142 188 Z" fill={s} />
          {outfit === "jacket" && <path d="M100 224 L100 262" fill="none" />}
          {outfit !== "jacket" && <circle cx="100" cy="242" r="3" fill={s} />}
        </>
      )}
      {outfit === "shirt" && (
        <>
          <path d="M100 180 L100 262" fill="none" stroke={s} strokeWidth="3" />
          <path d="M78 172 L92 194 L100 180 L108 194 L122 172 Q100 182 78 172 Z" fill={s} />
          {[204, 222, 240].map((y) => (
            <circle key={y} cx="100" cy={y} r="2.8" fill={light} strokeWidth="1.6" />
          ))}
        </>
      )}
      {/* a fold or two in the fabric */}
      <path d={`M${100 + 40 * b} 214 Q${100 + 50 * b} 232 ${100 + 46 * b} 252 M${100 - 44 * b} 222 Q${100 - 52 * b} 238 ${100 - 48 * b} 254`} fill="none" stroke={s} strokeWidth="2.4" />
    </g>
  );
}

/** A cartoon hand, palm out, fingers up. Local origin is the middle of the palm. */
function OpenHand({ skin, x, y, rot }: { skin: string; x: number; y: number; rot: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} fill={skin} strokeWidth="2.5">
      <rect x="-14" y="-33" width="7.5" height="23" rx="3.75" />
      <rect x="-6.5" y="-38" width="7.5" height="28" rx="3.75" />
      <rect x="1" y="-37" width="7.5" height="27" rx="3.75" />
      <rect x="8.5" y="-30" width="7" height="20" rx="3.5" />
      <rect x="-27" y="-13" width="17" height="8" rx="4" transform="rotate(-28 -14 -9)" />
      <path d="M-15 -14 C-15 -24 16 -24 16 -14 L15 4 C13 13 -13 13 -15 4 Z" />
      <path d="M-6 -2 Q0 2 6 -3" fill="none" strokeWidth="1.6" opacity="0.5" />
    </g>
  );
}

function PointHand({ skin, x, y, rot }: { skin: string; x: number; y: number; rot: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} fill={skin} strokeWidth="2.5">
      <rect x="-4" y="-44" width="8.5" height="34" rx="4.25" />
      <rect x="-14" y="-18" width="28" height="28" rx="11" />
      <path d="M-11 -6 L9 -6 M-11 2 L9 2" fill="none" strokeWidth="1.8" />
      <path d="M-14 -2 Q-4 -10 6 -4" fill="none" strokeWidth="2.2" />
    </g>
  );
}

function ArmTube({ d, color }: { d: string; color: string }) {
  return (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth="30" />
      <path d={d} fill="none" stroke={color} strokeWidth="24.4" />
    </>
  );
}

function RightArm({ look, kind }: { look: Look; kind: "open" | "point" }) {
  const bare = look.outfit === "tee";
  const sx = 100 + 54 * look.build;
  const hx = 100 + 92 * look.build;
  return (
    <g>
      {bare ? (
        <>
          <ArmTube d={`M${sx} 216 Q${hx - 4} 220 ${hx - 2} 180`} color={look.skin} />
          <ArmTube d={`M${sx} 216 Q${sx + 26} 216 ${sx + 34} 204`} color={look.outfitColor} />
        </>
      ) : (
        <ArmTube d={`M${sx} 216 Q${hx - 4} 220 ${hx - 2} 182`} color={look.outfitColor} />
      )}
      {!bare && <path d={`M${hx - 12} 186 L${hx + 8} 186`} strokeWidth="2.4" />}
      {kind === "open" ? <OpenHand skin={look.skin} x={hx} y={164} rot={10} /> : <PointHand skin={look.skin} x={hx - 2} y={168} rot={4} />}
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
          <ArmTube d="M40 236 Q100 206 160 228" color={look.outfitShade} />
          <ArmTube d="M160 244 Q100 220 42 230" color={look.outfitColor} />
          <ellipse cx="154" cy="226" rx="10" ry="8.5" fill={look.skin} strokeWidth="2.4" />
          <ellipse cx="47" cy="230" rx="10" ry="8.5" fill={look.skin} strokeWidth="2.4" />
          <path d="M150 222 L158 222 M43 226 L51 226" strokeWidth="1.6" />
        </g>
      );
    default:
      return null;
  }
}

function Hair({ look, fill, clipId }: { look: Look; fill: string; clipId: string }) {
  const { rx, ry } = look.head;
  const L = 100 - rx, R = 100 + rx, T = CY - ry;
  const fx = look.turn * rx * 0.2;
  const strand = { stroke: shade(look.hair, look.hair > "#B0" ? -0.3 : -0.4), strokeWidth: 2.2, fill: "none" };
  const light = { stroke: shade(look.hair, 0.35), strokeWidth: 2.4, fill: "none", opacity: 0.8 };

  switch (look.hairStyle) {
    case "capLong": {
      const cap = look.cap!;
      return (
        <g>
          <path d={`M${L - 3} ${CY - 6} C${L - 4} ${T - 4} ${100 - rx * 0.4} ${T - 14} 100 ${T - 14} C${100 + rx * 0.4} ${T - 14} ${R + 4} ${T - 4} ${R + 3} ${CY - 6} Z`} fill={cap.color} />
          <path d={`M${100 + rx * 0.25} ${T - 10} C${R - 6} ${T} ${R} ${CY - 26} ${R + 2} ${CY - 8} L${R - 12} ${CY - 8} C${R - 14} ${CY - 30} ${100 + rx * 0.5} ${T - 4} ${100 + rx * 0.25} ${T - 10} Z`} fill={cap.shade} stroke="none" opacity="0.55" />
          <path d={`M100 ${T - 14} L100 ${CY - 8}`} fill="none" stroke={cap.shade} strokeWidth="2" />
          <path
            d={`M${L - 6} ${CY - 8} C${100 - 20} ${CY - 26} ${R + 10} ${CY - 24} ${R + 30} ${CY - 2} C${R + 32} ${CY + 6} ${R + 18} ${CY + 10} ${R} ${CY + 5} C${100 + 10} ${CY - 6} ${100 - 30} ${CY - 4} ${L - 2} ${CY + 2} Z`}
            fill={cap.shade}
          />
          <path d={`M${84 + fx} ${T + 8} L${92 + fx} ${T - 2} L${99 + fx} ${T + 5} L${107 + fx} ${T - 5} L${118 + fx} ${T + 8}`} stroke="#FFFFFF" strokeWidth="3.2" fill="none" />
          <path d={`M${L} ${CY + 4} C${L - 2} ${CY + 22} ${L + 2} ${CY + 34} ${L + 8} ${CY + 42}`} fill="none" stroke={look.hair} strokeWidth="12" />
          <path d={`M${R} ${CY + 4} C${R + 2} ${CY + 22} ${R - 2} ${CY + 34} ${R - 8} ${CY + 42}`} fill="none" stroke={look.hair} strokeWidth="12" />
        </g>
      );
    }
    case "quiff":
      return (
        <g>
          <clipPath id={clipId}>
            <path d={hairMass(look, { vol: 11, lumps: 6, bump: 4, swoop: { at: 262, h: 8 }, hairline: 0.35, part: -6 })} />
          </clipPath>
          <path d={hairMass(look, { vol: 11, lumps: 6, bump: 4, swoop: { at: 262, h: 8 }, hairline: 0.35, part: -6 })} fill={fill} />
          <g clipPath={`url(#${clipId})`}>
            <path d={`M${100 - 22} ${T + 4} C${100 - 6} ${T - 8} ${100 + 16} ${T - 8} ${R - 12} ${T + 8} M${L + 12} ${CY - 26} C${100 - 18} ${T + 8} ${100 + 6} ${T + 2} ${100 + 24} ${T + 6}`} {...strand} />
            <path d={`M${100 - 12} ${T - 4} C${100} ${T - 12} ${100 + 14} ${T - 12} ${100 + 24} ${T - 6}`} {...light} />
          </g>
        </g>
      );
    case "curly": {
      const outer = crown(look, 192, 348, 10, 1.06);
      const inner = crown(look, 205, 335, 7, 0.82);
      return (
        <g fill={fill}>
          <path d={`M${L + 2} ${CY + 2} C${L - 4} ${T + 4} ${100 - rx * 0.5} ${T - 6} 100 ${T - 6} C${100 + rx * 0.5} ${T - 6} ${R + 4} ${T + 4} ${R - 2} ${CY + 2} C${R - 10} ${CY - 22} ${100 + 20} ${CY - 30} 100 ${CY - 30} C${100 - 20} ${CY - 30} ${L + 10} ${CY - 22} ${L + 2} ${CY + 2} Z`} />
          {outer.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={14 + (i % 3)} />
          ))}
          {inner.map(([x, y], i) => (
            <circle key={`i${i}`} cx={x} cy={y + 4} r={12} />
          ))}
          {/* a couple of curls falling over the forehead */}
          <circle cx={100 + fx + 14} cy={CY - ry * 0.55} r="9" />
          <circle cx={100 + fx - 4} cy={CY - ry * 0.6} r="8" />
          {outer.slice(1, -1).map(([x, y], i) => (
            <path key={`c${i}`} d={`M${x - 6} ${y + 2} q6 -7 12 0`} {...strand} />
          ))}
        </g>
      );
    }
    case "messyGrey":
      return (
        <g>
          <clipPath id={clipId}>
            <path d={hairMass(look, { vol: 14, lumps: 7, bump: 7, swoop: { at: 300, h: 6 }, hairline: 0.45, part: 8 })} />
          </clipPath>
          <path d={hairMass(look, { vol: 14, lumps: 7, bump: 7, swoop: { at: 300, h: 6 }, hairline: 0.45, part: 8 })} fill={fill} />
          <g clipPath={`url(#${clipId})`}>
            <path d={`M${100 - 30} ${T - 2} q8 -10 18 -3 M${100 + 4} ${T - 6} q10 -10 22 -2 M${L + 6} ${CY - 26} q6 -10 16 -8`} {...light} />
          </g>
        </g>
      );
    case "spiky":
      return (
        <g>
          <clipPath id={clipId}>
            <path d={hairMass(look, { vol: 10, lumps: 8, bump: 7, swoop: { at: 262, h: 6 }, hairline: 0.32, part: 4, sharp: true })} />
          </clipPath>
          <path d={hairMass(look, { vol: 10, lumps: 8, bump: 7, swoop: { at: 262, h: 6 }, hairline: 0.32, part: 4, sharp: true })} fill={fill} />
          <g clipPath={`url(#${clipId})`}>
            <path d={`M${100 - 16} ${T + 2} L${100 - 10} ${T - 10} M${100 + 10} ${T} L${100 + 16} ${T - 12}`} {...light} />
          </g>
        </g>
      );
    case "pompadour":
      return (
        <g>
          <clipPath id={clipId}>
            <path d={hairMass(look, { vol: 15, lumps: 6, bump: 3, swoop: { at: 255, h: 9 }, hairline: 0.25, part: -14 })} />
          </clipPath>
          <path d={hairMass(look, { vol: 15, lumps: 6, bump: 3, swoop: { at: 255, h: 9 }, hairline: 0.25, part: -14 })} fill={fill} />
          <g clipPath={`url(#${clipId})`}>
            <path d={`M${L + 10} ${CY - 22} C${100 - 30} ${T - 4} ${100 + 4} ${T - 12} ${R - 8} ${T + 6} M${100 - 30} ${T + 10} C${100 - 12} ${T - 4} ${100 + 16} ${T - 4} ${R - 14} ${T + 12}`} {...strand} />
            <path d={`M${100 - 22} ${T - 8} C${100 - 8} ${T - 18} ${100 + 12} ${T - 16} ${100 + 22} ${T - 8}`} {...light} />
          </g>
        </g>
      );
    case "silverBack":
      return (
        <g>
          <clipPath id={clipId}>
            <path d={hairMass(look, { vol: 11, lumps: 7, bump: 4, swoop: { at: 285, h: 4 }, hairline: 0.55, part: 0 })} />
          </clipPath>
          <path d={hairMass(look, { vol: 11, lumps: 7, bump: 4, swoop: { at: 285, h: 4 }, hairline: 0.55, part: 0 })} fill={fill} />
          <g clipPath={`url(#${clipId})`}>
            <path d={`M${L + 8} ${CY - 20} C${100 - 26} ${T + 2} ${100 + 10} ${T - 6} ${R - 8} ${T + 8} M${100 - 30} ${T + 12} C${100 - 10} ${T + 2} ${100 + 18} ${T + 2} ${R - 12} ${T + 16} M${L + 14} ${CY - 8} C${100 - 22} ${T + 18} ${100 + 6} ${T + 10} ${100 + 26} ${T + 16}`} stroke="#AEB6BE" strokeWidth="2.2" fill="none" />
          </g>
        </g>
      );
    case "sidePart":
      return (
        <g>
          <clipPath id={clipId}>
            <path d={hairMass(look, { vol: 8, lumps: 5, bump: 2.5, swoop: { at: 290, h: 4 }, hairline: 0.3, part: -rx * 0.35 })} />
          </clipPath>
          <path d={hairMass(look, { vol: 8, lumps: 5, bump: 2.5, swoop: { at: 290, h: 4 }, hairline: 0.3, part: -rx * 0.35 })} fill={fill} />
          <g clipPath={`url(#${clipId})`}>
            <path d={`M${100 - rx * 0.35} ${T + 18} C${100 - rx * 0.3} ${T + 4} ${100 - rx * 0.2} ${T - 4} ${100 - rx * 0.1} ${T - 8}`} {...strand} />
            <path d={`M${100 - 6} ${T + 2} C${100 + 10} ${T - 4} ${100 + 26} ${T} ${R - 10} ${T + 10}`} {...light} />
          </g>
        </g>
      );
    case "buzz":
      return (
        <g stroke="none">
          <clipPath id={clipId}>
            <path d={hairMass(look, { vol: 2, lumps: 6, bump: 1, hairline: 0.7, part: 0 })} />
          </clipPath>
          <path d={hairMass(look, { vol: 2, lumps: 6, bump: 1, hairline: 0.7, part: 0 })} fill={look.hair} opacity="0.78" />
          <g clipPath={`url(#${clipId})`}>
            <path d={`M${100 - 26} ${T + 10} l1 3 M${100 - 10} ${T + 6} l0 3 M${100 + 6} ${T + 6} l0 3 M${100 + 22} ${T + 9} l-1 3`} {...strand} />
          </g>
        </g>
      );
    case "balding":
      return (
        <g fill={fill}>
          <path d={`M${L - 2} ${CY + 14} C${L - 6} ${CY - 8} ${L} ${CY - 26} ${L + 14} ${CY - 34} C${L + 10} ${CY - 16} ${L + 12} ${CY} ${L + 16} ${CY + 14} Z`} />
          <path d={`M${R + 2} ${CY + 14} C${R + 6} ${CY - 8} ${R} ${CY - 26} ${R - 14} ${CY - 34} C${R - 10} ${CY - 16} ${R - 12} ${CY} ${R - 16} ${CY + 14} Z`} />
          <path d={`M${100 - 18} ${T + 8} C${100 - 6} ${T + 2} ${100 + 8} ${T + 2} ${100 + 20} ${T + 7}`} fill="none" strokeWidth="2.4" stroke="#B8BEC4" />
          <ellipse cx={100 - rx * 0.2} cy={T + ry * 0.2} rx={rx * 0.32} ry={ry * 0.12} fill="#FFFFFF" stroke="none" opacity="0.35" />
        </g>
      );
    case "shortNeat":
    default:
      return (
        <g>
          <clipPath id={clipId}>
            <path d={hairMass(look, { vol: 7, lumps: 6, bump: 2.5, hairline: 0.4, part: -8 })} />
          </clipPath>
          <path d={hairMass(look, { vol: 7, lumps: 6, bump: 2.5, hairline: 0.4, part: -8 })} fill={fill} />
          <g clipPath={`url(#${clipId})`}>
            <path d={`M${100 - rx * 0.4} ${T + 4} C${100 - 10} ${T - 4} ${100 + 8} ${T - 6} ${100 + rx * 0.4} ${T + 2}`} {...strand} />
            <path d={`M${100 - 8} ${T - 4} C${100 + 4} ${T - 8} ${100 + 16} ${T - 6} ${100 + 24} ${T - 2}`} {...light} />
          </g>
        </g>
      );
  }
}

function Beard({ look, fill }: { look: Look; fill: string }) {
  if (!look.beard) return null;
  const { rx, ry } = look.head;
  const L = 100 - rx, R = 100 + rx, B = CY + ry;
  const fx = look.turn * rx * 0.2;
  const my = CY + ry * 0.5;
  const tex = { stroke: shade(look.beardColor ?? look.hair, -0.4), strokeWidth: 2, fill: "none" };
  const mustache = (
    <path
      d={`M${100 + fx - 22} ${my + 2} C${100 + fx - 12} ${my - 10} ${100 + fx - 3} ${my - 6} ${100 + fx} ${my - 3} C${100 + fx + 3} ${my - 6} ${100 + fx + 12} ${my - 10} ${100 + fx + 22} ${my + 2} C${100 + fx + 10} ${my + 4} ${100 + fx + 3} ${my + 2} ${100 + fx} ${my + 2} C${100 + fx - 3} ${my + 2} ${100 + fx - 10} ${my + 4} ${100 + fx - 22} ${my + 2} Z`}
      fill={fill}
    />
  );
  if (look.beard === "full")
    return (
      <g>
        <path
          d={`M${L + 1} ${CY + 2} C${L + 1} ${B + 12} ${100 - rx * 0.5} ${B + 22} 100 ${B + 22} C${100 + rx * 0.5} ${B + 22} ${R - 1} ${B + 12} ${R - 1} ${CY + 2} C${R - 8} ${CY + 30} ${100 + rx * 0.45} ${my + 12} ${100 + fx + 24} ${my + 10} C${100 + fx + 10} ${my + 18} ${100 + fx - 10} ${my + 18} ${100 + fx - 24} ${my + 10} C${100 - rx * 0.45} ${my + 12} ${L + 8} ${CY + 30} ${L + 1} ${CY + 2} Z`}
          fill={fill}
        />
        <path d={`M${L + 16} ${B - 4} l3 6 M${100 - 18} ${B + 10} l1 6 M100 ${B + 14} l0 6 M${100 + 18} ${B + 10} l-1 6 M${R - 16} ${B - 4} l-3 6`} {...tex} />
        {mustache}
      </g>
    );
  const short = (
    <path
      d={`M${L + 6} ${CY + 14} C${L + 8} ${B + 4} ${100 - rx * 0.45} ${B + 10} 100 ${B + 10} C${100 + rx * 0.45} ${B + 10} ${R - 8} ${B + 4} ${R - 6} ${CY + 14} C${R - 14} ${my + 6} ${100 + fx + 20} ${my + 12} ${100 + fx + 14} ${my + 14} C${100 + fx + 6} ${my + 18} ${100 + fx - 6} ${my + 18} ${100 + fx - 14} ${my + 14} C${100 + fx - 20} ${my + 12} ${L + 14} ${my + 6} ${L + 6} ${CY + 14} Z`}
      fill={fill}
    />
  );
  if (look.beard === "stubble") return <g opacity="0.28" stroke="none">{short}</g>;
  return (
    <g>
      {short}
      <path d={`M${100 - 20} ${B + 2} l1 5 M100 ${B + 6} l0 5 M${100 + 20} ${B + 2} l-1 5`} {...tex} />
      {mustache}
    </g>
  );
}

function Face({ look, soft }: { look: Look; soft: string }) {
  const { rx, ry } = look.head;
  const fx = look.turn * rx * 0.2;
  const ex = rx * 0.36;
  const ey = CY + 6;
  const lx = 100 + fx - ex;
  const rxEye = 100 + fx + ex;
  const brow = look.browColor ?? shade(look.hair, look.hairStyle === "balding" || look.hairStyle === "silverBack" ? -0.35 : -0.15);
  const ny = CY + 22;
  const my = CY + ry * 0.55;
  const mx = 100 + fx * 1.1;
  const dir = look.turn >= 0 ? 1 : -1;

  const browPaths = {
    flat: [`M${lx - 11} ${ey - 15} Q${lx} ${ey - 19} ${lx + 11} ${ey - 15}`, `M${rxEye - 11} ${ey - 15} Q${rxEye} ${ey - 19} ${rxEye + 11} ${ey - 15}`],
    raised: [`M${lx - 12} ${ey - 18} Q${lx} ${ey - 27} ${lx + 12} ${ey - 19}`, `M${rxEye - 12} ${ey - 19} Q${rxEye} ${ey - 27} ${rxEye + 12} ${ey - 18}`],
    determined: [`M${lx - 12} ${ey - 21} L${lx + 11} ${ey - 13}`, `M${rxEye + 12} ${ey - 21} L${rxEye - 11} ${ey - 13}`],
    soft: [`M${lx - 11} ${ey - 16} Q${lx} ${ey - 22} ${lx + 11} ${ey - 17}`, `M${rxEye - 11} ${ey - 17} Q${rxEye} ${ey - 22} ${rxEye + 11} ${ey - 16}`],
    oneUp: [`M${lx - 11} ${ey - 15} Q${lx} ${ey - 18} ${lx + 11} ${ey - 15}`, `M${rxEye - 12} ${ey - 20} Q${rxEye} ${ey - 30} ${rxEye + 12} ${ey - 22}`],
  }[look.brows];

  const eye = (x: number) => {
    switch (look.eyes) {
      case "narrow":
        return (
          <g key={x}>
            <path d={`M${x - 8} ${ey} Q${x} ${ey - 7} ${x + 8} ${ey} Q${x} ${ey + 5} ${x - 8} ${ey} Z`} fill={INK} stroke="none" />
            <path d={`M${x - 10} ${ey - 3} Q${x} ${ey - 9} ${x + 10} ${ey - 3}`} fill="none" strokeWidth="2.2" />
            <circle cx={x + 2.5} cy={ey - 2} r="1.8" fill="#FFFFFF" stroke="none" />
          </g>
        );
      case "happy":
        return <path key={x} d={`M${x - 8} ${ey + 3} Q${x} ${ey - 8} ${x + 8} ${ey + 3}`} fill="none" strokeWidth="3.4" />;
      case "wide":
        return (
          <g key={x} stroke="none">
            <ellipse cx={x} cy={ey} rx="7.8" ry="10.4" fill={INK} />
            <circle cx={x + 2.8} cy={ey - 4} r="3.2" fill="#FFFFFF" />
            <circle cx={x - 2.4} cy={ey + 3.6} r="1.4" fill="#FFFFFF" />
          </g>
        );
      default:
        return (
          <g key={x} stroke="none">
            <ellipse cx={x} cy={ey} rx="6.8" ry="9" fill={INK} />
            <circle cx={x + 2.4} cy={ey - 3.4} r="2.7" fill="#FFFFFF" />
          </g>
        );
    }
  };

  const nose =
    look.nose === "long"
      ? `M${100 + fx * 1.25} ${ny - 16} Q${100 + fx * 1.25 + dir * 9} ${ny + 2} ${100 + fx * 1.25 - dir * 2} ${ny + 4}`
      : look.nose === "broad"
        ? `M${100 + fx * 1.25 - 7} ${ny} Q${100 + fx * 1.25} ${ny + 7} ${100 + fx * 1.25 + 7} ${ny} M${100 + fx * 1.25 + dir * 2} ${ny - 12} Q${100 + fx * 1.25 + dir * 6} ${ny - 4} ${100 + fx * 1.25 + dir * 5} ${ny - 1}`
        : `M${100 + fx * 1.25} ${ny - 7} Q${100 + fx * 1.25 + dir * 7} ${ny} ${100 + fx * 1.25} ${ny + 3}`;

  return (
    <g>
      {browPaths.map((d, i) => (
        <path key={i} d={d} stroke={brow} strokeWidth="5.6" fill="none" />
      ))}
      {look.shades ? (
        <g>
          <path d={`M${lx - 15} ${ey - 9} L${lx + 14} ${ey - 9} L${lx + 12} ${ey + 8} Q${lx} ${ey + 13} ${lx - 13} ${ey + 7} Z`} fill="#1B1D21" />
          <path d={`M${rxEye - 14} ${ey - 9} L${rxEye + 15} ${ey - 9} L${rxEye + 13} ${ey + 7} Q${rxEye} ${ey + 13} ${rxEye - 12} ${ey + 8} Z`} fill="#1B1D21" />
          <path d={`M${lx + 14} ${ey - 7} Q${100 + fx} ${ey - 10} ${rxEye - 14} ${ey - 7}`} fill="none" strokeWidth="3.4" />
          <path d={`M${lx - 9} ${ey - 5} L${lx - 2} ${ey - 5} M${rxEye - 8} ${ey - 5} L${rxEye - 1} ${ey - 5}`} stroke="#FFFFFF" strokeWidth="2.4" opacity="0.7" />
        </g>
      ) : (
        <>{[eye(lx), eye(rxEye)]}</>
      )}
      {look.glasses && (
        <g fill="none" strokeWidth="2.6">
          <circle cx={lx} cy={ey} r="12" />
          <circle cx={rxEye} cy={ey} r="12" />
          <path d={`M${lx + 12} ${ey - 2} Q${100 + fx} ${ey - 6} ${rxEye - 12} ${ey - 2}`} />
        </g>
      )}
      {look.older && <path d={`M${lx - 16} ${ey + 2} q-3 4 -1 8 M${rxEye + 16} ${ey + 2} q3 4 1 8 M${mx - 26} ${my - 10} q-4 8 0 14 M${mx + 26} ${my - 10} q4 8 0 14`} stroke={look.skinShade} strokeWidth="2.4" fill="none" />}
      <g stroke="none" filter={soft}>
        <ellipse cx={lx - 6} cy={ey + 18} rx="10" ry="6.5" fill="#EE8F86" opacity="0.5" />
        <ellipse cx={rxEye + 6} cy={ey + 18} rx="10" ry="6.5" fill="#EE8F86" opacity="0.5" />
      </g>
      <path d={nose} fill="none" strokeWidth="2.6" />
      <Mouth look={look} mx={mx} my={my} />
    </g>
  );
}

function Mouth({ look, mx, my }: { look: Look; mx: number; my: number }) {
  switch (look.mouth) {
    case "toothy":
      return (
        <g>
          <path d={`M${mx - 19} ${my - 3} Q${mx} ${my + 24} ${mx + 19} ${my - 3} Q${mx} ${my + 1} ${mx - 19} ${my - 3} Z`} fill="#5A2626" />
          <path d={`M${mx - 16} ${my - 1} Q${mx} ${my + 3} ${mx + 16} ${my - 1} L${mx + 14} ${my + 5} Q${mx} ${my + 8} ${mx - 14} ${my + 5} Z`} fill="#FFFFFF" stroke="none" />
          <path d={`M${mx - 8} ${my + 13} Q${mx} ${my + 8} ${mx + 8} ${my + 13} Q${mx} ${my + 18} ${mx - 8} ${my + 13} Z`} fill="#E07C7C" stroke="none" />
        </g>
      );
    case "talk":
      return (
        <g>
          <path d={`M${mx - 11} ${my} Q${mx} ${my - 4} ${mx + 11} ${my} Q${mx + 2} ${my + 16} ${mx - 11} ${my} Z`} fill="#5A2626" />
          <path d={`M${mx - 5} ${my + 8} Q${mx} ${my + 5} ${mx + 5} ${my + 8} Q${mx} ${my + 11} ${mx - 5} ${my + 8} Z`} fill="#E07C7C" stroke="none" />
        </g>
      );
    case "grin":
      return (
        <g>
          <path d={`M${mx - 15} ${my - 2} Q${mx} ${my + 18} ${mx + 15} ${my - 2} Z`} fill="#5A2626" />
          <path d={`M${mx - 12} ${my - 0.5} L${mx + 12} ${my - 0.5} L${mx + 10} ${my + 4} L${mx - 10} ${my + 4} Z`} fill="#FFFFFF" stroke="none" />
        </g>
      );
    case "smirk":
      return <path d={`M${mx - 13} ${my + 2} Q${mx + 2} ${my + 10} ${mx + 14} ${my - 4}`} fill="none" strokeWidth="3.4" />;
    case "calm":
      return <path d={`M${mx - 9} ${my + 2} Q${mx} ${my + 6} ${mx + 9} ${my + 2}`} fill="none" strokeWidth="3.2" />;
    case "smile":
    default:
      return <path d={`M${mx - 14} ${my} Q${mx} ${my + 13} ${mx + 14} ${my}`} fill="none" strokeWidth="3.4" />;
  }
}
