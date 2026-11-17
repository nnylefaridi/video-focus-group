-- Hosted mode: how each account pays for its reviews, remembered so the choice is
-- only asked once. 'credits' pays from a prepaid balance; 'own_key' runs the review
-- on the person's own Anthropic API key. Like every table here it lives in `app`
-- with row level security on and no policies: only the server reads or writes it.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'app' and t.typname = 'payment_method'
  ) then
    create type app.payment_method as enum ('credits', 'own_key');
  end if;
end $$;

create table if not exists app.account_billing (
  user_id uuid primary key,
  payment_method app.payment_method not null,
  updated_at bigint not null
);

alter table app.account_billing enable row level security;
