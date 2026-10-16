import { execFile } from "node:child_process";

export function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 10 * 60 * 1000 },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr).split("\n").slice(-6).join("\n");
          reject(new Error(`${cmd} failed: ${tail || err.message}`));
        } else resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** Run async tasks with a concurrency limit, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
