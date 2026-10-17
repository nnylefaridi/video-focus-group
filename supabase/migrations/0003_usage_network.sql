-- Signed-in people get their own allowance (client_key = their account), and every
-- use also records the network it came from (network_key = hashed IP) so one
-- network has an overall ceiling. Earlier rows were keyed by network already.
alter table app.usage add column if not exists network_key text;
update app.usage set network_key = client_key where network_key is null;
create index if not exists usage_network on app.usage (network_key, kind, at);
