import { beforeAll, describe, expect, it } from "vitest";

type Prereqs = typeof import("../../scripts/prereqs.mjs");

const ubuntu2404 = { id: "ubuntu", versionId: "24.04", idLike: "debian", pretty: "Ubuntu 24.04.5 LTS" };
const base = {
  platform: "linux",
  release: ubuntu2404,
  arch: "x64",
  nodeVersion: "22.23.4",
  has: () => true,
  whisper: { name: "whisper-cli", path: "/usr/local/bin/whisper-cli" },
  whisperHelp: null,
};

describe("setup preflight", () => {
  let p: Prereqs;
  beforeAll(async () => {
    p = await import("../../scripts/prereqs.mjs");
  });

  it("accepts Node 20.9 and newer, and rejects Ubuntu 24.04's apt Node 18", () => {
    expect(p.nodeVersionOk("20.9.0")).toBe(true);
    expect(p.nodeVersionOk("v22.23.4")).toBe(true);
    expect(p.nodeVersionOk("20.8.1")).toBe(false);
    expect(p.nodeVersionOk("18.19.1")).toBe(false);
  });

  it("reads os-release and treats Ubuntu as Debian-family", () => {
    const release = p.readOsRelease('ID=ubuntu\nVERSION_ID="24.04"\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04.5 LTS"\n');
    expect(release).toMatchObject(ubuntu2404);
    expect(p.isDebianFamily(release)).toBe(true);
    expect(p.isDebianFamily({ id: "fedora", versionId: "40", idLike: "", pretty: "" })).toBe(false);
  });

  it("names the nodejs.org tarball for this CPU", () => {
    expect(p.nodeTarballArch("x64")).toBe("linux-x64");
    expect(p.nodeTarballArch("arm64")).toBe("linux-arm64");
    expect(p.nodeTarballArch("ppc64")).toBe(null);
  });

  it("finds whisper-cli before a binary named whisper-cpp", () => {
    const lookup = (name: string) => (name === "whisper-cpp" ? "/usr/bin/whisper-cpp" : name === "whisper-cli" ? "/usr/local/bin/whisper-cli" : null);
    expect(p.findWhisper(lookup)).toEqual({ name: "whisper-cli", path: "/usr/local/bin/whisper-cli" });
    expect(p.findWhisper((name: string) => (name === "whisper-cpp" ? "/opt/whisper-cpp" : null))).toEqual({
      name: "whisper-cpp",
      path: "/opt/whisper-cpp",
    });
    expect(p.findWhisper(() => null)).toBe(null);
  });

  it("prints the Ubuntu 24.04 commands that were checked, not apt's Node 18", () => {
    const plan = p.installPlan({
      ...base,
      nodeVersion: "18.19.1",
      has: (cmd: string) => cmd === "ffmpeg",
      whisper: null,
    });
    expect(plan.ok).toBe(false);
    const text = plan.problems.map((problem: { title: string; lines: string[] }) => [problem.title, ...problem.lines].join("\n")).join("\n");
    expect(text).toContain("18.19.1");
    expect(text).toContain("don't install Node from apt");
    expect(text).toContain("linux-x64\\.tar\\.xz");
    expect(text).toContain("sudo apt install -y ffmpeg");
    expect(text).not.toContain("apt install -y nodejs");
    expect(text).toContain("git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp.git");
    expect(text).toContain("cmake --build build -j 2");
    expect(text).toContain("sudo ldconfig");
    expect(text).not.toContain("brew install");
  });

  it("prints Homebrew commands on macOS", () => {
    const plan = p.installPlan({
      ...base,
      platform: "darwin",
      release: { id: "", versionId: "", idLike: "", pretty: "" },
      nodeVersion: "18.0.0",
      has: () => false,
      whisper: null,
    });
    const text = plan.problems.map((problem: { lines: string[] }) => problem.lines.join("\n")).join("\n");
    expect(text).toContain("brew install node");
    expect(text).toContain("brew upgrade node");
    expect(text).toContain("brew install ffmpeg");
    expect(text).toContain("brew install whisper-cpp");
    expect(text).not.toContain("sudo apt");
  });

  it("says to run ldconfig when whisper-cli cannot see its libraries", () => {
    const plan = p.installPlan({
      ...base,
      whisperHelp: { ok: false, libraries: true, detail: "libwhisper.so.1: cannot open shared object file" },
    });
    expect(plan.ok).toBe(false);
    expect(plan.problems[0].lines.join("\n")).toContain("sudo ldconfig");
    expect(plan.problems[0].lines.join("\n")).not.toContain("git clone");
  });

  it("passes when node, ffmpeg, ffprobe and whisper-cli are all present", () => {
    expect(p.installPlan(base).ok).toBe(true);
  });
});
