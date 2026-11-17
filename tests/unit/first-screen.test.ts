/**
 * The first screen is only the first question and its answer box: the Buy me a coffee tag
 * isn't rendered there (not even by the server, so it can't flash in), and is everywhere else.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const { CoffeeLink, showCoffeeLink } = await import("@/components/CoffeeLink");
const { isFirstScreen } = await import("@/components/flow/Flow");

const serverHtml = (pathname: string) => {
  nav.pathname = pathname;
  return renderToString(createElement(CoffeeLink));
};

describe("the Buy me a coffee tag", () => {
  it("isn't in the server's first screen at all", () => {
    expect(serverHtml("/")).toBe("");
  });

  it("is on every other page, as before", () => {
    for (const p of ["/reviews", "/r/AAAAAAAAAAAAAAAA", "/reviewers/mrbeast", "/login", "/nope"]) {
      expect(serverHtml(p)).toContain('href="https://buymeacoffee.com/nylefaridi"');
    }
  });

  it("comes back on the start page once the flow moves past the first question", () => {
    expect(showCoffeeLink("/", false)).toBe(false);
    expect(showCoffeeLink("/", true)).toBe(true);
  });
});

describe("the first screen", () => {
  const a = { questionId: "what", display: "a skit", fields: {} };
  it("is the first question with nothing answered", () => {
    expect(isFirstScreen("questions", [], null)).toBe(true);
  });

  it("isn't any later question, an edit, the board or the upload", () => {
    expect(isFirstScreen("questions", [a], null)).toBe(false);
    expect(isFirstScreen("questions", [], "what")).toBe(false);
    expect(isFirstScreen("board", [a], null)).toBe(false);
    expect(isFirstScreen("upload", [a], null)).toBe(false);
  });
});
