-- Which way each paid call was paid for. Calls on someone's own Anthropic key
-- ('own_key') are still logged, but don't count toward the app-wide daily and
-- monthly caps, which protect the server's own key. Null: the server's key (as
-- every earlier row was).
alter table app.spend add column if not exists paid_with app.payment_method;
