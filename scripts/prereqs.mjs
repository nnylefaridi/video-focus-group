// What `npm run setup` checks, and the install commands it prints.
// macOS gets Homebrew commands. Ubuntu/Debian gets apt plus a whisper.cpp build
// that was run on Ubuntu 24.04. Other systems get the tool names, not a guessed package command.
import { execFileSync } from "node:child_process";
import os from "node:os";

export function nodeVersionOk(version) {
  const [major, minor] = String(version).replace(/^v/, "").split(".").map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 20 || (major === 20 && minor >= 9);
}

export function readOsRelease(text) {
  const get = (key) => {
    const m = String(text).match(new RegExp(`^${key}=(.*)$`, "m"));
    if (!m) return "";
    return m[1].trim().replace(/^"|"$/g, "");
  };
  return { id: get("ID"), versionId: get("VERSION_ID"), idLike: get("ID_LIKE"), pretty: get("PRETTY_NAME") };
}

export function isDebianFamily(release) {
  const blob = ` ${release?.id ?? ""} ${release?.idLike ?? ""} `.toLowerCase();
  return / (ubuntu|debian|linuxmint|pop|elementary|zorin|raspbian|neon) /.test(blob);
}

/** Path of a program on PATH, or null. Uses `command -v` so macOS and Linux agree. */
export function commandPath(cmd) {
  try {
    const out = execFileSync("/bin/sh", ["-c", 'command -v "$1"', "sh", cmd], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const line = out.trim().split("\n").filter(Boolean)[0];
    return line || null;
  } catch {
    return null;
  }
}

/** Current whisper.cpp CLI, then the older package name for the same program. */
export const WHISPER_NAMES = ["whisper-cli", "whisper-cpp"];

export function findWhisper(lookup = commandPath) {
  for (const name of WHISPER_NAMES) {
    const found = lookup(name);
    if (found) return { name, path: found };
  }
  return null;
}

/** nodejs.org tarball arch, or null when we don't know the filename. */
export function nodeTarballArch(arch = os.arch()) {
  if (arch === "x64") return "linux-x64";
  if (arch === "arm64") return "linux-arm64";
  return null;
}

function nodeInstallLines(platform, release, arch) {
  if (platform === "darwin") {
    return ["Install or upgrade Node.js with Homebrew:", "", "brew install node", "", "If Node is already installed but too old: brew upgrade node"];
  }
  if (isDebianFamily(release)) {
    const token = nodeTarballArch(arch);
    const lines = [
      "Panel needs Node.js 20.9 or newer. Ubuntu 24.04's own nodejs package is 18.19.1, which is too old, so don't install Node from apt on that release.",
      "Install Node.js 22 from nodejs.org. The x86_64 tarball (v22.23.5 when checked) was unpacked and run on Ubuntu 24.04:",
      "",
    ];
    if (!token) {
      lines.push("This CPU isn't x86_64 or arm64. Download the matching Linux build from https://nodejs.org/en/download");
      return lines;
    }
    lines.push(
      `VER=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/node-v[0-9.]+-${token}\\.tar\\.xz$/ { print $2; exit }')`,
      'curl -fsSL -o "/tmp/$VER" "https://nodejs.org/dist/latest-v22.x/$VER"',
      'sudo tar -xJf "/tmp/$VER" -C /usr/local --strip-components=1',
      "hash -r",
      "node -v && npm -v",
      "",
      "Close and reopen the terminal if node -v still shows the old version.",
    );
    return lines;
  }
  return ["Install Node.js 20.9 or newer from https://nodejs.org. The setup script's install commands were checked on Ubuntu 24.04, and it prints Homebrew commands on macOS."];
}

function ffmpegInstallLines(platform, release) {
  if (platform === "darwin") {
    return ["brew install ffmpeg", "", "Then check that both ffmpeg and ffprobe run."];
  }
  if (isDebianFamily(release)) {
    return ["sudo apt update", "sudo apt install -y ffmpeg", "", "On Ubuntu 24.04 that package includes both ffmpeg and ffprobe."];
  }
  return ["Install ffmpeg so both ffmpeg and ffprobe are on your PATH. On Ubuntu 24.04 the package is ffmpeg."];
}

function whisperBuildLines() {
  return [
    "sudo apt update",
    "sudo apt install -y build-essential cmake git",
    "git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp.git",
    "cd whisper.cpp",
    "cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++",
    "cmake --build build -j 2",
    "sudo cmake --install build",
    "sudo ldconfig",
    "whisper-cli -h",
    "",
    "If whisper-cli cannot find libwhisper.so.1, run sudo ldconfig again.",
    "Panel runs whisper-cli, or a program named whisper-cpp if that's the name on your PATH. An old binary named main only prints a retirement notice. Set WHISPER_BIN in .env.local to use a different path.",
  ];
}

function whisperInstallLines(platform, release) {
  if (platform === "darwin") {
    return [
      "brew install whisper-cpp",
      "",
      "That formula's program is named whisper-cli. Check with: whisper-cli -h",
      "An older build's program was named main. That name is retired; install the formula again so you get whisper-cli.",
    ];
  }
  const intro =
    release?.id === "ubuntu" && release?.versionId === "24.04"
      ? "Ubuntu 24.04 does not package whisper.cpp (apt has no whisper.cpp candidate). Build whisper-cli from tag v1.9.5, which is the build that was run here:"
      : "Build whisper-cli from tag v1.9.5. This build was run on Ubuntu 24.04, where apt does not ship whisper.cpp:";
  if (platform === "linux" && !isDebianFamily(release)) {
    return [
      "Install a C compiler, cmake and git, then build whisper-cli. The apt lines below are for Ubuntu/Debian; the cmake steps are what was run on Ubuntu 24.04:",
      "",
      ...whisperBuildLines(),
    ];
  }
  return [intro, "", ...whisperBuildLines()];
}

/**
 * @param {{
 *   platform: string,
 *   release: { id: string, versionId: string, idLike: string, pretty?: string },
 *   arch: string,
 *   nodeVersion: string,
 *   has: (cmd: string) => boolean,
 *   whisper: { name: string, path: string } | null,
 *   whisperHelp: { ok: boolean, libraries: boolean, detail: string } | null,
 * }} opts
 */
export function installPlan(opts) {
  const release = opts.release ?? { id: "", versionId: "", idLike: "" };
  const problems = [];
  if (!nodeVersionOk(opts.nodeVersion)) {
    problems.push({
      title: `Node.js 20.9 or newer is needed (you have ${opts.nodeVersion}).`,
      lines: nodeInstallLines(opts.platform, release, opts.arch),
    });
  }
  const missingMedia = ["ffmpeg", "ffprobe"].filter((cmd) => !opts.has(cmd));
  if (missingMedia.length) {
    problems.push({
      title: `Missing ${missingMedia.join(" and ")}.`,
      lines: ffmpegInstallLines(opts.platform, release),
    });
  }
  if (!opts.whisper) {
    problems.push({
      title: "Missing whisper-cli (whisper.cpp).",
      lines: whisperInstallLines(opts.platform, release),
    });
  } else if (opts.whisperHelp && !opts.whisperHelp.ok) {
    const lines = opts.whisperHelp.libraries
      ? ["The program is installed, but the linker can't see its libraries.", "", "sudo ldconfig", "", "Then run whisper-cli -h. It should exit without an error."]
      : [
          "That program doesn't look like the whisper.cpp CLI Panel calls (flags -m, -f, -ojf, -of, -np and -l).",
          "",
          ...whisperInstallLines(opts.platform, release),
        ];
    if (opts.whisperHelp.detail) lines.push("", "It printed:", ...opts.whisperHelp.detail.split("\n").slice(0, 6));
    problems.push({ title: `${opts.whisper.name} is on your PATH, but it doesn't run.`, lines });
  }
  return { ok: problems.length === 0, problems };
}
