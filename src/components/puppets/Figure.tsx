import { useId } from "react";
import type { Look } from "./looks";

/**
 * A reviewer drawn as a squishy paper-cutout cartoon (head and shoulders).
 * The white cutout edge comes from one SVG filter that dilates the silhouette.
 * viewBox "full" = 0 0 200 240; "head" crops to the face for small avatars.
 */
export function Figure({ look, crop = "full", className, title }: { look: Look; crop?: "full" | "head"; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const viewBox = crop === "head" ? "18 4 164 172" : "-8 -8 216 256";
  const ink = "#2A2A2E";

  return (
    <svg viewBox={viewBox} className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <filter id={`cut-${id}`} x="-15%" y="-15%" width="130%" height="130%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="5.5" result="grown" />
          <feFlood floodColor="#ffffff" />
          <feComposite in2="grown" operator="in" result="edge" />
          <feMerge>
            <feMergeNode in="edge" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {crop === "head" && (
          <clipPath id={`clip-${id}`}>
            <rect x="12" y="-2" width="176" height="184" rx="30" />
          </clipPath>
        )}
      </defs>
      <g filter={`url(#cut-${id})`} clipPath={crop === "head" ? `url(#clip-${id})` : undefined}>
        <HairBack look={look} />
        <Body look={look} />
        {/* ears */}
        <circle cx="41" cy="97" r="12" fill={look.skin} />
        <circle cx="159" cy="97" r="12" fill={look.skin} />
        <path d="M37 93 Q43 97 39 103" stroke={look.skinShade} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M163 93 Q157 97 161 103" stroke={look.skinShade} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {/* head: a slightly squished, soft oval */}
        <path d="M100 26 C140 26 161 52 161 90 C161 130 136 154 100 154 C64 154 39 130 39 90 C39 52 60 26 100 26 Z" fill={look.skin} />
        <Beard look={look} />
        <Hair look={look} />
        <Face look={look} ink={ink} />
      </g>
    </svg>
  );
}

function HairBack({ look }: { look: Look }) {
  if (look.hairStyle !== "capLong") return null;
  return (
    <g fill={look.hair}>
      <path d="M44 78 C30 118 28 168 40 198 L76 192 C62 160 58 122 62 96 Z" />
      <path d="M156 78 C170 118 172 168 160 198 L124 192 C138 160 142 122 138 96 Z" />
    </g>
  );
}

function Body({ look }: { look: Look }) {
  const { outfit, outfitColor: c, outfitShade: s } = look;
  return (
    <g>
      <rect x="85" y="138" width="30" height="40" rx="12" fill={look.skinShade} />
      {outfit === "hoodie" && <path d="M58 182 Q100 150 142 182 Q128 200 100 202 Q72 200 58 182 Z" fill={s} />}
      <path
        d="M22 240 C22 198 52 170 100 168 C148 170 178 198 178 240 Z"
        fill={c}
        stroke={look.hairOutline && outfit === "suit" ? "#D3D8DE" : "none"}
        strokeWidth="2"
      />
      {outfit === "tee" && <path d="M80 170 Q100 188 120 170" stroke={s} strokeWidth="5" fill="none" strokeLinecap="round" />}
      {outfit === "hoodie" && (
        <>
          <path d="M70 184 Q100 200 130 184" stroke={s} strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M90 194 L88 222 M110 194 L112 222" stroke="#E6E9EE" strokeWidth="3" strokeLinecap="round" />
          <circle cx="88" cy="224" r="3" fill="#E6E9EE" />
          <circle cx="112" cy="224" r="3" fill="#E6E9EE" />
        </>
      )}
      {(outfit === "jacket" || outfit === "blazer" || outfit === "suit") && (
        <>
          <path d="M82 170 L100 214 L118 170 Z" fill={look.inner ?? s} />
          <path d="M82 170 L100 214 L74 206 L64 182 Z" fill={s} />
          <path d="M118 170 L100 214 L126 206 L136 182 Z" fill={s} />
          {look.tie && <path d="M96 176 L104 176 L107 206 L100 216 L93 206 Z" fill={look.tie} />}
          {outfit === "jacket" && <path d="M100 214 L100 240" stroke={s} strokeWidth="3" />}
        </>
      )}
      {outfit === "shirt" && (
        <>
          <path d="M80 168 L93 188 L100 174 L107 188 L120 168 Q100 176 80 168 Z" fill={s} />
          <path d="M100 176 L100 240" stroke={s} strokeWidth="3" />
          {[196, 212, 228].map((y) => (
            <circle key={y} cx="100" cy={y} r="2.6" fill="#E6E9EE" />
          ))}
        </>
      )}
    </g>
  );
}

function Hair({ look }: { look: Look }) {
  const h = look.hair;
  const o = look.hairOutline;
  const stroke = o ? { stroke: o, strokeWidth: 2.5 } : {};
  switch (look.hairStyle) {
    case "capLong":
      return (
        <g>
          <path d="M40 84 C38 42 64 20 100 20 C136 20 162 42 160 84 Z" fill={look.cap!.color} />
          <path d="M100 20 L100 84" stroke={look.cap!.shade} strokeWidth="2" opacity="0.6" />
          <path d="M32 82 C70 66 142 66 178 86 C180 94 172 98 162 96 C132 88 76 88 38 94 C32 92 30 86 32 82 Z" fill={look.cap!.shade} />
          <path d="M84 60 L92 50 L99 57 L106 48 L116 60" stroke="#FFFFFF" strokeWidth="3.2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <path d="M42 94 C40 110 42 118 46 124 M158 94 C160 110 158 118 154 124" stroke={h} strokeWidth="10" strokeLinecap="round" />
        </g>
      );
    case "shortTextured":
      return (
        <g fill={h}>
          <path d="M40 94 C34 50 60 22 102 22 C146 24 166 54 160 94 C156 76 150 66 142 60 C134 68 120 62 114 54 C106 64 90 62 84 54 C76 64 62 64 56 66 C48 74 44 82 40 94 Z" />
          <path d="M98 22 C104 10 118 8 124 14 C116 16 110 20 108 26 Z" />
        </g>
      );
    case "curly": {
      const curls: [number, number, number][] = [
        [46, 76, 15], [52, 54, 16], [66, 36, 16], [86, 26, 16], [108, 24, 16], [128, 30, 16], [146, 46, 16], [155, 70, 15],
        [70, 54, 14], [92, 44, 14], [114, 44, 14], [134, 56, 13],
      ];
      return (
        <g fill={h}>
          <path d="M42 88 C38 42 68 22 100 22 C132 22 162 42 158 88 C150 66 130 58 100 58 C70 58 50 66 42 88 Z" />
          {curls.map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} />
          ))}
        </g>
      );
    }
    case "messyGrey":
      return (
        <g>
          <path
            d="M40 94 C32 56 56 24 98 22 C146 20 170 52 160 94 C158 78 152 70 146 66 C152 56 142 48 134 52 C130 40 114 42 110 50 C100 38 84 44 82 54 C70 50 58 56 62 66 C50 68 44 80 40 94 Z"
            fill={h}
          />
          <path d="M70 40 C80 34 90 34 98 38 M114 34 C126 34 136 40 142 48" stroke="#A8ADB2" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
    case "swept":
      return (
        <g fill={h} {...stroke}>
          <path d="M41 90 C35 48 62 18 104 18 C146 18 168 46 159 84 C150 66 132 60 112 60 C96 60 84 56 78 46 C72 56 56 68 41 90 Z" />
          {o && (
            <path d="M66 44 C88 30 120 28 146 42 M84 54 C104 44 128 44 148 54" stroke={o} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          )}
        </g>
      );
    case "sidePart":
      return (
        <g>
          <path d="M40 92 C36 50 62 22 100 22 C140 22 164 48 160 92 C154 72 146 62 134 58 C112 64 86 60 70 50 C58 60 48 74 40 92 Z" fill={h} />
          <path d="M70 50 C84 40 100 33 116 31" stroke="#00000033" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
    case "buzz":
      return <path d="M42 86 C40 46 66 24 100 24 C134 24 160 46 158 86 C152 64 140 54 100 52 C60 54 48 64 42 86 Z" fill={h} opacity="0.92" />;
    case "balding":
      return (
        <g fill={h}>
          <path d="M40 100 C36 78 42 62 54 54 C52 70 52 86 56 102 Z" />
          <path d="M160 100 C164 78 158 62 146 54 C148 70 148 86 144 102 Z" />
          <path d="M82 34 C94 28 108 28 120 33" stroke={h} strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
      );
    case "shortNeat":
    default:
      return (
        <path d="M40 90 C36 48 62 22 100 22 C138 22 164 48 160 90 C156 72 146 62 134 58 C120 50 80 50 66 58 C54 64 44 74 40 90 Z" fill={h} />
      );
  }
}

function Beard({ look }: { look: Look }) {
  if (!look.beard) return null;
  const c = look.beardColor ?? look.hair;
  const mustache = <path d="M76 124 C86 114 96 116 100 120 C104 116 114 114 124 124 C112 127 104 125 100 125 C96 125 88 127 76 124 Z" fill={c} />;
  if (look.beard === "full")
    return (
      <g>
        <path d="M40 92 C40 142 64 168 100 170 C136 168 160 142 160 92 C154 114 142 128 128 130 C118 120 82 120 72 130 C58 128 46 114 40 92 Z" fill={c} />
        {mustache}
      </g>
    );
  const shape = (
    <path d="M48 106 C52 146 74 160 100 162 C126 160 148 146 152 106 C146 124 134 134 124 134 C116 126 84 126 76 134 C66 134 54 124 48 106 Z" fill={c} />
  );
  if (look.beard === "stubble") return <g opacity="0.22">{shape}</g>;
  return (
    <g>
      {shape}
      {mustache}
    </g>
  );
}

function Face({ look, ink }: { look: Look; ink: string }) {
  const brow = look.browColor ?? (look.hairStyle === "balding" ? look.hair : look.hair === "#F2F2EF" ? "#B9BEC4" : look.hair);
  const browPaths = {
    flat: ["M69 81 Q80 77 91 81", "M109 81 Q120 77 131 81"],
    raised: ["M68 77 Q80 69 92 76", "M108 76 Q120 69 132 77"],
    determined: ["M69 77 L91 84", "M131 77 L109 84"],
    soft: ["M70 80 Q80 75 90 79", "M110 79 Q120 75 130 80"],
  }[look.brows];
  const mouthY = look.beard === "full" ? 0 : 0;
  return (
    <g>
      {browPaths.map((d, i) => (
        <path key={i} d={d} stroke={brow} strokeWidth="5" fill="none" strokeLinecap="round" />
      ))}
      {look.shades ? (
        <g>
          <rect x="62" y="86" width="34" height="22" rx="9" fill="#1E2126" />
          <rect x="104" y="86" width="34" height="22" rx="9" fill="#1E2126" />
          <path d="M96 93 Q100 90 104 93" stroke="#1E2126" strokeWidth="4" fill="none" />
          <path d="M68 92 L76 92 M110 92 L118 92" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
        </g>
      ) : (
        <g>
          <ellipse cx="80" cy="98" rx="6.8" ry="9" fill={ink} />
          <ellipse cx="120" cy="98" rx="6.8" ry="9" fill={ink} />
          <circle cx="82.5" cy="94.5" r="2.6" fill="#FFFFFF" />
          <circle cx="122.5" cy="94.5" r="2.6" fill="#FFFFFF" />
        </g>
      )}
      {look.older && (
        <path d="M60 108 Q64 112 62 116 M140 108 Q136 112 138 116" stroke={look.skinShade} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      )}
      <circle cx="68" cy="116" r="8" fill="#F29C93" opacity="0.38" />
      <circle cx="132" cy="116" r="8" fill="#F29C93" opacity="0.38" />
      <path d="M100 103 Q107 111 99 114" stroke={look.skinShade} strokeWidth="3" fill="none" strokeLinecap="round" />
      <g transform={`translate(0 ${mouthY})`}>
        {look.mouth === "grin" && (
          <g>
            <path d="M84 124 Q100 147 116 124 Z" fill="#7A3838" />
            <path d="M86 125 L114 125 L112.5 129 L87.5 129 Z" fill="#FFFFFF" />
          </g>
        )}
        {look.mouth === "smile" && <path d="M87 127 Q100 138 113 127" stroke={ink} strokeWidth="3.5" fill="none" strokeLinecap="round" />}
        {look.mouth === "smirk" && <path d="M89 130 Q102 135 113 125" stroke={ink} strokeWidth="3.5" fill="none" strokeLinecap="round" />}
        {look.mouth === "calm" && <path d="M91 130 Q100 134 109 130" stroke={ink} strokeWidth="3.5" fill="none" strokeLinecap="round" />}
      </g>
    </g>
  );
}
