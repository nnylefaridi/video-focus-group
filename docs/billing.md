# Billing: prepaid credits (hosted mode)

Local mode has none of this. Reviews there run on the `ANTHROPIC_API_KEY` in `.env.local`, as before.

In hosted mode (`PANEL_MODE=hosted`) an account pays for reviews with its own Anthropic API key or with prepaid credits. This page covers credits.

## Money in: top-ups through Stripe Checkout

- There are three packs: **$10, $25 and $50** (`CREDIT_PACKS` in `src/core/credits.ts`). $10 is the smallest.
- The browser only names a pack (`POST /api/credits/checkout {pack}`). The server looks up its price and creates a Checkout Session with `mode=payment`, the price inline (`price_data`), `client_reference_id` set to the account id, and `metadata` holding the account id and pack. The success and cancel URLs are built from `HOSTED_PUBLIC_URL`.
- Credit is added only when Stripe's webhook (`POST /api/stripe/webhook`) arrives with a valid signature. The signature is checked over the raw body with `stripe.webhooks.constructEvent`.
  - `checkout.session.completed` credits the account only when `payment_status = 'paid'`. Card payments are paid at that point.
  - `checkout.session.async_payment_succeeded` credits delayed payment methods once their money arrives.
  - The amount credited is `amount_total`, the amount actually paid. The pack label isn't used.
- Every event id goes into `app.stripe_events` in the same transaction as its effect, so a replayed event does nothing. There's also a unique index on the Checkout Session id for top-ups, so the two events for one session can never both add credit.

## The ledger

Migration `supabase/migrations/0007_credits.sql`. All amounts are whole **micro-dollars** (1 = $0.000001). There are no floats.

- `app.credit_accounts` holds one row per account with `balance` and `reserved`. CHECK constraints keep `balance >= 0`, `reserved >= 0` and `reserved <= balance`. Every change locks the row first (`SELECT ... FOR UPDATE`), so two reviews starting at once can't both spend the same credit.
- `app.credit_ledger` is append-only, enforced by a trigger. Each entry has a kind: `topup`, `reserve`, `charge`, `release` or `adjustment`. It also records the balance and the reserved amount right after the entry.
- `app.credit_reservations` holds the credit set aside for one review run or one follow-up answer.

## Money out: reviews and follow-ups

1. **Before a review runs** (when it's created, and again for each retry), its worst case is set aside: `REVIEW_COST_CAP_USD × 1.2`, which is $3.60 by default. This happens inside the same transaction and locks as the existing daily limits. If the account doesn't have that much free, the review isn't created, and the person is told how much is needed and how much they have.
2. **Each paid Anthropic call** first claims its own worst case from the reservation. The worst case is an upper bound on the call's input (every byte of text counts as a token, and images count by their pixel size) plus its `max_tokens` of output. A call only starts if everything already spent plus every call still running plus this call, all times 1.2, fits in the reservation. If the full output doesn't fit, the call gets a smaller `max_tokens` that does. If not even a useful minimum fits, it waits for running calls to finish. With nothing running, the review stops with a plain message. So a review can't cost more than its reservation, even with reviewer passes running in parallel.
3. **When the run ends**, whether it finished or failed, it's charged Anthropic's actual cost × 1.2, rounded **up** to the micro-dollar, and the rest of the reservation is released. Anthropic's cost is recorded per call already (`app.spend` and the review's `cost`); each call's cost is rounded up to the micro-dollar before it's added.
4. **Each follow-up answer** sets aside `FOLLOWUP_COST_CAP_USD × 1.2` ($1.80 by default) under the follow-up lock. It's charged the same way when the answer ends.
5. An upload that's abandoned or rejected gives back everything set aside for it. Follow-up reservations whose request died get settled by the worker after an hour.

## Refunds and disputes

- Unused credit **isn't refunded in cash** by default. The top-up UI says so, and the terms will too.
- `charge.refunded` and `charge.dispute.created` take the refunded or disputed amount back as an `adjustment`. The amount is capped at what that top-up added and counts what earlier events already took (Stripe reports refunds as a running total).
- If the account doesn't have that much free, Panel takes what it can and doesn't let the balance go negative. It records the rest in `owed` and puts the account **on hold** (`on_hold_at`, `on_hold_reason`). An account on hold can't start paid reviews or buy more credit.
- Clearing a hold is a manual decision for the owner, for example after the person repays:

  ```sql
  update app.credit_accounts set on_hold_at = null, on_hold_reason = null, owed = 0, updated_at = (extract(epoch from now()) * 1000)::bigint
  where user_id = '<account id>';
  ```

- A won dispute (`charge.dispute.funds_reinstated`) is **not** credited back automatically. If a dispute is won, add an `adjustment` by hand.

## Why a 20% margin covers Stripe's fee, even on the $10 minimum

The margin is `MARGIN = 1.2` in `src/server/credits.ts`. Credits pay Anthropic's cost × 1.2, so of every $1.20 of credit spent, $1.00 goes to Anthropic and $0.20 stays.

Stripe's standard US card fee is 2.9% + $0.30.

| Top-up | Stripe fee | Anthropic cost if all of it is spent (÷ 1.2) | Margin kept | Left after the fee |
| --- | --- | --- | --- | --- |
| $10 | 0.029 × 10 + 0.30 = **$0.59** | $10 / 1.2 = $8.3333 | $1.6667 | **+$1.077** |
| $25 | 0.029 × 25 + 0.30 = $1.025 | $20.8333 | $4.1667 | +$3.142 |
| $50 | 0.029 × 50 + 0.30 = $1.75 | $41.6667 | $8.3333 | +$6.583 |

International cards add 1.5% and currency conversion adds 1%, so the fee becomes (2.9% + 1.5% + 1%) = 5.4% + $0.30:

| Top-up | Fee with both | Margin kept | Left after the fee |
| --- | --- | --- | --- |
| $10 | 0.054 × 10 + 0.30 = **$0.84** | $1.6667 | **+$0.827** |
| $25 | 0.054 × 25 + 0.30 = $1.65 | $4.1667 | +$2.517 |
| $50 | 0.054 × 50 + 0.30 = $3.00 | $8.3333 | +$5.333 |

So even a $10 top-up spent entirely nets at least $0.82 after every fee. Bigger packs do better because the fixed $0.30 is spread over more.

What this doesn't cover:
- Stripe keeps its processing fee when a payment is refunded, and charges a dispute fee. That's part of why credit isn't refunded in cash by default.
- The margin assumes the prices in `PRICES` (`src/ai/client.ts`) match what Anthropic charges. Update them when Anthropic's prices change.

## Settings

Hosted mode won't start without `STRIPE_SECRET_KEY` (`sk_live_…`, `sk_test_…` or a restricted `rk_…` key) and `STRIPE_WEBHOOK_SECRET` (`whsec_…`). If either is missing, it says which one.

In the Stripe Dashboard, add a webhook endpoint at `<HOSTED_PUBLIC_URL>/api/stripe/webhook` that sends these events:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `charge.refunded`
- `charge.dispute.created`
