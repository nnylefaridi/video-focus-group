import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORT_VERSION } from "./cdn";

describe("speech runtime files", () => {
  it("are fetched for the same onnxruntime-web version the app bundles", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../../node_modules/onnxruntime-web/package.json"), "utf8"));
    expect(ORT_VERSION).toBe(pkg.version);
  });
});
