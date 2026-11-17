import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("@/lib/supabase-browser", () => ({
  supabaseBrowser: () => ({ auth: { signOut: async () => {} } }),
}));

const { displayNameFor, avatarLetter } = await import("@/core/account-label");
const { FlowHeader } = await import("@/components/flow/FlowHeader");
const { StartPay, START_CHOICES } = await import("@/components/flow/StartPay");

describe("the account display name", () => {
  it("prefers full_name, then name, then the email's local part", () => {
    expect(displayNameFor({ email: "nyle@example.com", user_metadata: { full_name: "Nyle Faridi", name: "Other" } })).toBe("Nyle Faridi");
    expect(displayNameFor({ email: "nyle@example.com", user_metadata: { name: "Nyle" } })).toBe("Nyle");
    expect(displayNameFor({ email: "nyle@example.com" })).toBe("nyle");
  });

  it("ignores empty metadata and falls back", () => {
    expect(displayNameFor({ email: "  nyle@example.com  ", user_metadata: { full_name: "  ", name: "" } })).toBe("nyle");
    expect(displayNameFor({ email: "solo" })).toBe("solo");
    expect(displayNameFor({})).toBe("Account");
    expect(displayNameFor({ email: "  ", user_metadata: null })).toBe("Account");
  });

  it("uses the first letter of the name for the avatar", () => {
    expect(avatarLetter("Nyle Faridi")).toBe("N");
    expect(avatarLetter("  émile")).toBe("É");
    expect(avatarLetter("")).toBe("A");
  });
});

describe("the first-screen header", () => {
  it("shows a solid Log in / Sign up button when signed out", () => {
    const out = renderToString(createElement(FlowHeader, { showLogin: true }));
    expect(out).toContain("Log in / Sign up");
    expect(out).toContain('href="/login?next=/"');
    expect(out).toContain("bg-accent");
    expect(out).not.toContain("Log out");
  });

  it("shows nothing off the first screen when signed out", () => {
    expect(renderToString(createElement(FlowHeader, { showLogin: false }))).toBe("");
  });

  it("shows the name and first letter when signed in, and not the log-in button", () => {
    const out = renderToString(createElement(FlowHeader, { showLogin: false, account: { name: "Nyle Faridi" } }));
    expect(out).toContain("Nyle Faridi");
    expect(out).toContain(">N<");
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("Log in / Sign up");
    expect(out).not.toContain("Log out");
  });
});

describe("the first-screen payment choices", () => {
  it("labels the credits option Buy credits", () => {
    expect(START_CHOICES.map((c) => c.label)).toEqual(["Buy credits", "Use your own Anthropic key"]);
    const out = renderToString(createElement(StartPay, { pay: null, onPayment: () => {} }));
    expect(out).toContain("Buy credits");
    expect(out).not.toContain("Pay as you go");
  });
});
