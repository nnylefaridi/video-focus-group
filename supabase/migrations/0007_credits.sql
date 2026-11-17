-- Hosted mode: prepaid credits bought through Stripe Checkout (src/server/credits.ts,
-- src/server/stripe.ts, docs/billing.md). Every amount is a whole number of
-- micro-dollars (1 = $0.000001, so $5 = 5000000): no floating point anywhere.
-- Server-only like every table here: row level security on, no policies.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'app' and t.typname = 'credit_entry'
  ) then
    create type app.credit_entry as enum ('topup', 'reserve', 'charge', 'release', 'adjustment');
  end if;
end $$;

-- One row per account, locked (SELECT ... FOR UPDATE) for every change, so parallel
-- reviews can't spend the same credit twice. balance is what the account holds;
-- reserved is the part set aside for reviews and follow-ups running now. Neither can
-- go negative and nothing can be set aside that isn't there.
-- on_hold_at: a refund or dispute couldn't be fully taken back from the balance, so
-- new paid reviews and top-ups are refused until the owner clears it (owed says how
-- much couldn't be taken back).
create table if not exists app.credit_accounts (
  user_id uuid primary key,
  balance bigint not null default 0,
  reserved bigint not null default 0,
  owed bigint not null default 0,
  on_hold_at bigint,
  on_hold_reason text,
  updated_at bigint not null,
  constraint credit_balance_not_negative check (balance >= 0),
  constraint credit_reserved_not_negative check (reserved >= 0),
  constraint credit_reserved_within_balance check (reserved <= balance),
  constraint credit_owed_not_negative check (owed >= 0)
);

-- Credit set aside for one review run or one follow-up answer. cost is what Anthropic
-- charged for its calls so far (each rounded up to the micro-dollar); in_flight is the
-- worst case of calls still running. A call only starts if (cost + in_flight + its own
-- worst case) x margin still fits in amount. When it's settled, cost x margin (rounded
-- up) is charged and the rest of amount released.
create table if not exists app.credit_reservations (
  id bigserial primary key,
  user_id uuid not null references app.credit_accounts (user_id),
  review_id text not null,
  purpose text not null check (purpose in ('review', 'followup')),
  amount bigint not null check (amount > 0),
  cost bigint not null default 0 check (cost >= 0),
  in_flight bigint not null default 0 check (in_flight >= 0),
  status text not null default 'open' check (status in ('open', 'settled')),
  charged bigint check (charged >= 0 and charged <= amount),
  created_at bigint not null,
  settled_at bigint
);
create index if not exists credit_reservations_open on app.credit_reservations (review_id) where status = 'open';

-- Append-only record of every change. amount is the signed change to balance for
-- topup (+), charge (-) and adjustment (+/-); for reserve and release it's the amount
-- set aside or freed, which moves reserved, not balance. balance_after/reserved_after
-- are the account's values right after the entry. uncollected: the part of a refund
-- or dispute that couldn't be taken back (see owed).
create table if not exists app.credit_ledger (
  id bigserial primary key,
  user_id uuid not null references app.credit_accounts (user_id),
  kind app.credit_entry not null,
  amount bigint not null,
  balance_after bigint not null check (balance_after >= 0),
  reserved_after bigint not null check (reserved_after >= 0),
  uncollected bigint not null default 0 check (uncollected >= 0),
  reservation_id bigint references app.credit_reservations (id),
  review_id text,
  stripe_event_id text,
  stripe_session_id text,
  stripe_payment_intent text,
  note text,
  at bigint not null
);
-- A Checkout Session is credited at most once, whichever of its events arrives first.
create unique index if not exists credit_ledger_topup_session on app.credit_ledger (stripe_session_id) where kind = 'topup';
create index if not exists credit_ledger_user on app.credit_ledger (user_id, id);
create index if not exists credit_ledger_payment_intent on app.credit_ledger (stripe_payment_intent) where stripe_payment_intent is not null;

create or replace function app.credit_ledger_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'app.credit_ledger is append-only: add an adjustment entry instead of changing or removing one';
end $$;
drop trigger if exists credit_ledger_append_only on app.credit_ledger;
create trigger credit_ledger_append_only before update or delete on app.credit_ledger
  for each row execute function app.credit_ledger_append_only();

-- Every Stripe event handled, by its id, so a replayed event is never applied twice.
create table if not exists app.stripe_events (
  id text primary key,
  type text not null,
  outcome text not null,
  received_at bigint not null
);

alter table app.credit_accounts enable row level security;
alter table app.credit_reservations enable row level security;
alter table app.credit_ledger enable row level security;
alter table app.stripe_events enable row level security;
