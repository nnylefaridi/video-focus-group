-- Hosted mode: an account that pays with its own Anthropic API key keeps it here,
-- encrypted with AES-256-GCM under KEY_ENCRYPTION_SECRET (src/server/keyvault.ts).
-- The key itself is never stored in the clear: only its iv, auth tag and ciphertext
-- (base64), which secret sealed it (key_version, so the secret can be rotated), and
-- its last 4 characters for showing. rejected_at is set when Anthropic turns the key
-- down mid-review, until it's replaced. Server-only, like every table here.
create table if not exists app.api_keys (
  user_id uuid primary key,
  key_version smallint not null,
  iv text not null,
  auth_tag text not null,
  ciphertext text not null,
  last4 text not null,
  saved_at bigint not null,
  rejected_at bigint
);

alter table app.api_keys enable row level security;

-- How each review is paid for, fixed when it starts (and again when it's retried), so a
-- review started on someone's own key keeps running on it. Null: the server's key.
alter table app.reviews add column if not exists paid_with app.payment_method;
