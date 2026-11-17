// What `npm run setup` checks, and the install commands it prints.
// Only Node.js is needed: videos are prepared in the browser, so there's no ffmpeg or whisper.cpp.
// macOS gets Homebrew commands; Ubuntu/Debian gets the nodejs.org tarball that was run on Ubuntu 24.04.
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
      "Video Focus Group needs Node.js 20.9 or newer. Ubuntu 24.04's own nodejs package is 18.19.1, which is too old, so don't install Node from apt on that release.",
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

/**
 * @param {{
 *   platform: string,
 *   release: { id: string, versionId: string, idLike: string, pretty?: string },
 *   arch: string,
 *   nodeVersion: string,
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
  // Nothing else: videos are prepared in the browser, so ffmpeg and whisper.cpp aren't needed.
  return { ok: problems.length === 0, problems };
}
