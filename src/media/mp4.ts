/**
 * A small, careful reader for the header boxes of an MP4 / MOV, used to check the video the browser
 * sends from the file's own bytes (never from what the browser says about it). It reads only what's
 * in the bytes it's given (the first 4 MB of the file), never allocates by a size the file declares,
 * stops at fixed limits, and never throws: any problem comes back as `{ ok: false, reason }`.
 */

/** How much of the start of the file the checker reads. A faststart file has its index inside this. */
export const MP4_HEAD_BYTES = 4 * 1024 * 1024;

const MAX_DEPTH = 8;
const MAX_BOXES = 5000;

export type Mp4Track = {
  kind: "video" | "audio" | "other";
  /** The first sample entry's four-character code: avc1, hvc1, mp4a, Opus… */
  codec: string | null;
  /** Presentation size from the track header, before rotation. */
  width: number;
  height: number;
  /** Clockwise degrees from the track's matrix: 0, 90, 180 or 270. */
  rotation: 0 | 90 | 180 | 270;
};

export type Mp4Info = {
  brand: string | null;
  durationSec: number;
  video: Mp4Track[];
  audio: Mp4Track[];
  /** The first video track's size as shown (width and height swapped for 90° and 270°). */
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  /** The index (moov) comes before the media (mdat) and sits wholly inside the bytes read. */
  faststart: boolean;
  /** The file has a `udta` or `meta` box: tags such as a device name, a location or an encoder. */
  hasUdta: boolean;
  hasMeta: boolean;
};

export type Mp4Result = { ok: true; info: Mp4Info } | { ok: false; reason: string };

class Bad extends Error {}

type Box = { type: string; body: number; end: number };

function fourcc(v: DataView, at: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += String.fromCharCode(v.getUint8(at + i));
  return s;
}

/** Reads the box at `pos`. `limit` is where its container ends; `known` is false for the file's top level, where a box may run past the bytes we have. */
function readBox(v: DataView, pos: number, limit: number, known: boolean): Box {
  if (pos + 8 > limit) throw new Bad("A box header is cut off.");
  let size = v.getUint32(pos);
  const type = fourcc(v, pos + 4);
  let header = 8;
  if (size === 1) {
    if (pos + 16 > limit) throw new Bad("A box header is cut off.");
    const big = v.getBigUint64(pos + 8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Bad("A box is impossibly large.");
    size = Number(big);
    header = 16;
  } else if (size === 0) {
    size = known ? limit - pos : Number.MAX_SAFE_INTEGER; // runs to the end of its container (or of the file)
  }
  if (size < header) throw new Bad("A box has an invalid size.");
  const end = pos + size;
  if (known && end > limit) throw new Bad(`A ${type} box runs past the end of its parent.`);
  return { type, body: pos + header, end };
}

function walk(v: DataView, start: number, end: number, depth: number, count: { n: number }, fn: (b: Box) => void) {
  if (depth > MAX_DEPTH) throw new Bad("Boxes are nested too deeply.");
  let pos = start;
  while (pos + 8 <= end) {
    if (++count.n > MAX_BOXES) throw new Bad("The file has too many boxes.");
    const b = readBox(v, pos, end, true);
    fn(b);
    pos = b.end;
  }
}

const ROTATIONS = [0, 90, 180, 270] as const;

function rotationOf(a: number, b: number): 0 | 90 | 180 | 270 {
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI / 90) * 90;
  return ROTATIONS[(((deg % 360) + 360) % 360) / 90];
}

function need(v: DataView, at: number, n: number, end: number) {
  if (at < 0 || at + n > end) throw new Bad("A header is cut off.");
}

function parseTrack(v: DataView, trak: Box, count: { n: number }, flags: { udta: boolean; meta: boolean }): Mp4Track {
  const t: Mp4Track = { kind: "other", codec: null, width: 0, height: 0, rotation: 0 };
  walk(v, trak.body, trak.end, 2, count, (b) => {
    if (b.type === "udta") flags.udta = true;
    else if (b.type === "meta") flags.meta = true;
    else if (b.type === "tkhd") {
      need(v, b.body, 4, b.end);
      const version = v.getUint8(b.body);
      const m = b.body + 4 + (version === 1 ? 32 : 20) + 16; // after the times, ids, duration, layer, volume
      need(v, m, 44, b.end);
      const fixed = (at: number) => v.getInt32(at) / 65536;
      t.rotation = rotationOf(fixed(m), fixed(m + 4));
      t.width = Math.round(v.getUint32(m + 36) / 65536);
      t.height = Math.round(v.getUint32(m + 40) / 65536);
    } else if (b.type === "mdia") {
      walk(v, b.body, b.end, 3, count, (c) => {
        if (c.type === "hdlr") {
          need(v, c.body, 12, c.end);
          const h = fourcc(v, c.body + 8);
          t.kind = h === "vide" ? "video" : h === "soun" ? "audio" : "other";
        } else if (c.type === "minf") {
          walk(v, c.body, c.end, 4, count, (d) => {
            if (d.type !== "stbl") return;
            walk(v, d.body, d.end, 5, count, (e) => {
              if (e.type !== "stsd") return;
              need(v, e.body, 16, e.end);
              if (v.getUint32(e.body + 4) >= 1) t.codec = fourcc(v, e.body + 12);
            });
          });
        }
      });
    }
  });
  return t;
}

/** Reads the header boxes in `bytes` (the start of a file). Never throws. */
export function inspectMp4(bytes: Uint8Array): Mp4Result {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, MP4_HEAD_BYTES));
    const len = v.byteLength;
    const count = { n: 0 };
    const flags = { udta: false, meta: false };
    let brand: string | null = null;
    let moovAt = -1;
    let mdatAt = -1;
    let moovWhole = false;
    const movie: { durationSec: number | null } = { durationSec: null };
    const tracks: Mp4Track[] = [];

    let pos = 0;
    while (pos + 8 <= len) {
      if (++count.n > MAX_BOXES) throw new Bad("The file has too many boxes.");
      const b = readBox(v, pos, len, false);
      if (b.type === "ftyp" && pos === 0) {
        need(v, b.body, 4, len);
        brand = fourcc(v, b.body);
      } else if (b.type === "mdat") {
        if (mdatAt < 0) mdatAt = pos;
      } else if (b.type === "moov" && moovAt < 0) {
        moovAt = pos;
        if (b.end <= len) {
          moovWhole = true;
          walk(v, b.body, b.end, 1, count, (c) => {
            if (c.type === "udta") flags.udta = true;
            else if (c.type === "meta") flags.meta = true;
            else if (c.type === "mvhd") {
              need(v, c.body, 4, c.end);
              const version = v.getUint8(c.body);
              const at = c.body + 4 + (version === 1 ? 16 : 8);
              need(v, at, version === 1 ? 12 : 8, c.end);
              const timescale = v.getUint32(at);
              const duration = version === 1 ? Number(v.getBigUint64(at + 4)) : v.getUint32(at + 4);
              if (timescale === 0) throw new Bad("The movie header has no time scale.");
              movie.durationSec = duration / timescale;
            } else if (c.type === "trak") tracks.push(parseTrack(v, c, count, flags));
          });
        }
      }
      if (b.end > len) break; // can't skip past what we have
      pos = b.end;
    }

    if (moovAt < 0) {
      return { ok: false, reason: mdatAt >= 0 ? "The video's index (moov) isn't at the start of the file." : "There's no movie data in the file." };
    }
    if (!moovWhole) return { ok: false, reason: "The video's index (moov) is too large to sit at the start of the file." };
    const durationSec = movie.durationSec;
    if (durationSec === null || !Number.isFinite(durationSec)) return { ok: false, reason: "The movie header is missing." };

    const video = tracks.filter((t) => t.kind === "video");
    const audio = tracks.filter((t) => t.kind === "audio");
    const first = video[0];
    const swap = first?.rotation === 90 || first?.rotation === 270;
    return {
      ok: true,
      info: {
        brand,
        durationSec,
        video,
        audio,
        width: first ? (swap ? first.height : first.width) : 0,
        height: first ? (swap ? first.width : first.height) : 0,
        rotation: first?.rotation ?? 0,
        faststart: mdatAt < 0 || moovAt < mdatAt,
        hasUdta: flags.udta,
        hasMeta: flags.meta,
      },
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Bad ? e.message : "The file's header couldn't be read." };
  }
}

/** Why a parsed file isn't the plain, playable MP4 the browser is meant to send. Empty when it is. */
export function mp4Problems(info: Mp4Info): string[] {
  const out: string[] = [];
  if (info.brand === null) out.push("The file doesn't start with an MP4 header.");
  if (!info.faststart) out.push("The video's index isn't at the start of the file.");
  if (info.video.length !== 1) out.push(`The file has ${info.video.length} video tracks, not one.`);
  else if (info.video[0].codec !== "avc1" && info.video[0].codec !== "avc3") out.push(`The video isn't H.264 (it's ${info.video[0].codec ?? "unknown"}).`);
  if (info.audio.length > 1) out.push("The file has more than one audio track.");
  else if (info.audio.length === 1 && info.audio[0].codec !== "mp4a" && info.audio[0].codec !== "Opus")
    out.push(`The audio isn't AAC or Opus (it's ${info.audio[0].codec ?? "unknown"}).`);
  // `udta`/`meta` aren't refused: muxers write an empty one even with no tags. The browser drops
  // tags itself (a person's own device name or location only ever concerns their own review).
  return out;
}
