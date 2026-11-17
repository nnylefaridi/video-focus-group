/**
 * Hosted mode: how to pay is asked before the upload, and nothing is assumed. A saved choice
 * that can't pay yet (own key picked once, no key saved) asks again instead of jumping
 * straight to the key form.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PaymentContext } from "@/server/billing";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const { needsPaymentChoice } = await import("@/components/flow/Flow");
const { PaymentStep } = await import("@/components/flow/PaymentStep");

const credits = { available: 0, reviewReserve: 0 } as unknown as PaymentContext["credits"];
const ctx = (over: Partial<PaymentContext>): PaymentContext => ({ method: null, ready: false, problem: null, key: null, credits, ...over });

describe("whether to ask how to pay", () => {
  it("asks an account that has never chosen", () => {
    expect(needsPaymentChoice(ctx({}), false, false)).toBe(true);
  });

  it("asks again when the saved choice can't pay yet, instead of assuming it", () => {
    expect(needsPaymentChoice(ctx({ method: "own_key", problem: "Add your Anthropic API key first." }), false, false)).toBe(true);
    expect(needsPaymentChoice(ctx({ method: "credits", problem: "Top up first." }), false, false)).toBe(true);
  });

  it("doesn't ask a returning account whose choice is ready", () => {
    expect(needsPaymentChoice(ctx({ method: "own_key", ready: true }), false, false)).toBe(false);
    expect(needsPaymentChoice(ctx({ method: "credits", ready: true }), false, false)).toBe(false);
  });

  it("after a pick on this visit, goes on to that choice's setup", () => {
    expect(needsPaymentChoice(ctx({ method: "own_key" }), false, true)).toBe(false);
  });

  it("asks when they press Change", () => {
    expect(needsPaymentChoice(ctx({ method: "credits", ready: true }), true, true)).toBe(true);
  });

  it("never asks outside hosted mode", () => {
    expect(needsPaymentChoice(null, true, false)).toBe(false);
  });
});

describe("the payment question", () => {
  const html = (current: "credits" | "own_key" | null) =>
    renderToString(createElement(PaymentStep, { board: [], current, onBack: () => {}, onChosen: () => {} }));

  it("offers both ways with their terms, and picks neither for them", () => {
    const out = html(null);
    expect(out).toContain("How do you want to pay?");
    expect(out).toContain("Prepaid credits");
    expect(out).toContain("plus 20%");
    expect(out).toContain("$10");
    expect(out).toContain("Stripe");
    expect(out).toContain("My own Anthropic API key");
    expect(out).not.toContain('aria-checked="true"');
    expect(out).not.toMatch(/Add your Anthropic API key/);
  });
});
