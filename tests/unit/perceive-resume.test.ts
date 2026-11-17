/**
 * A review that was cut short (the host restarted) must not pay again for the frame descriptions
 * it already has: perception is saved batch by batch, and only batches without a saved result
 * are asked for. Claude and the frame images are replaced by test doubles.
 */
import { describe, expect, it, vi } from "vitest";
import type { Frame, FramePerception } from "@/core/evidence";

const calls = vi.hoisted(() => ({ labels: [] as string[] }));
vi.mock("@/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ai/client")>()),
  callStructured: async (opts: { label: string; messages: { content: { type: string; text?: string }[] }[] }) => {
    calls.labels.push(opts.label);
    const ids = (opts.messages[0].content.find((c) => c.text?.includes("one entry per frame id"))?.text ?? "").split("frame id: ")[1].replace(/\.$/, "").split(", ");
    return { frames: ids.map((frameId) => described(frameId)) };
  },
}));
vi.mock("@/ai/render", () => ({ labeledFrame: async () => ({ type: "text", text: "(image)" }), renderIntent: () => "a test video" }));

const described = (frameId: string): FramePerception => ({ frameId, description: `Frame ${frameId}`, onScreenText: "", captionsVisible: false, people: 0, framing: "medium", productVisible: null });
const frames = (n: number): Frame[] => Array.from({ length: n }, (_, i) => ({ id: `F${String(i + 1).padStart(3, "0")}`, t: i * 0.5, shotId: "S01", file: `frames/F${i + 1}.jpg`, dense: false }) as Frame);
const ctx = { intent: { category: "creator" } as never, transcript: [] };

describe("perceiveFrames resuming", () => {
  it("asks about every batch of 16 when nothing is saved, saving each as it finishes", async () => {
    const { perceiveFrames } = await import("@/ai/perceive");
    calls.labels.length = 0;
    const saved: number[] = [];
    const out = await perceiveFrames("rev", "/nowhere", frames(40), { ...ctx, onBatch: async (i) => void saved.push(i) });
    expect(out.map((p) => p.frameId)).toEqual(frames(40).map((f) => f.id));
    expect(calls.labels.sort()).toEqual(["perceive:1/3", "perceive:2/3", "perceive:3/3"]);
    expect(saved.sort()).toEqual([0, 1, 2]);
  });

  it("doesn't ask again for batches that were saved, and keeps the order", async () => {
    const { perceiveFrames } = await import("@/ai/perceive");
    calls.labels.length = 0;
    const all = frames(40);
    const savedBatches = { "0": all.slice(0, 16).map((f) => described(f.id)), "2": all.slice(32).map((f) => described(f.id)) };
    const saved: number[] = [];
    const out = await perceiveFrames("rev", "/nowhere", all, { ...ctx, saved: savedBatches, onBatch: async (i) => void saved.push(i) });
    expect(calls.labels).toEqual(["perceive:2/3"]);
    expect(saved).toEqual([1]);
    expect(out.map((p) => p.frameId)).toEqual(all.map((f) => f.id));
  });

  it("asks for nothing when every batch is saved", async () => {
    const { perceiveFrames } = await import("@/ai/perceive");
    calls.labels.length = 0;
    const all = frames(20);
    const out = await perceiveFrames("rev", "/nowhere", all, { ...ctx, saved: { "0": all.slice(0, 16).map((f) => described(f.id)), "1": all.slice(16).map((f) => described(f.id)) } });
    expect(calls.labels).toEqual([]);
    expect(out).toHaveLength(20);
  });

  it("only reuses saved batches for exactly the same frames", async () => {
    const { perceptionKey } = await import("@/ai/perceive");
    const a = frames(5);
    expect(perceptionKey(a)).toBe(perceptionKey(frames(5)));
    expect(perceptionKey(a)).not.toBe(perceptionKey(frames(6)));
    expect(perceptionKey(a)).not.toBe(perceptionKey(a.map((f, i) => (i === 2 ? { ...f, t: f.t + 0.25 } : f))));
  });
});
