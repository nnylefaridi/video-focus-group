-- Early writes stored some JSON values as a quoted JSON string ("{...}") instead of
-- the value itself. Unwrap them so database-side JSON operations see real objects.
update app.reviews set answers = (answers #>> '{}')::jsonb where jsonb_typeof(answers) = 'string';
update app.reviews set intent = (intent #>> '{}')::jsonb where jsonb_typeof(intent) = 'string';
update app.reviews set board = (board #>> '{}')::jsonb where jsonb_typeof(board) = 'string';
update app.reviews set video = (video #>> '{}')::jsonb where jsonb_typeof(video) = 'string';
update app.reviews set ledger = (ledger #>> '{}')::jsonb where jsonb_typeof(ledger) = 'string';
update app.reviews set notes = (notes #>> '{}')::jsonb where jsonb_typeof(notes) = 'string';
update app.reviews set discussion = (discussion #>> '{}')::jsonb where jsonb_typeof(discussion) = 'string';
update app.reviews set synthesis = (synthesis #>> '{}')::jsonb where jsonb_typeof(synthesis) = 'string';
update app.reviews set validation = (validation #>> '{}')::jsonb where jsonb_typeof(validation) = 'string';
update app.reviews set cost = (cost #>> '{}')::jsonb where jsonb_typeof(cost) = 'string';
update app.reviews set stored_files = (stored_files #>> '{}')::jsonb where jsonb_typeof(stored_files) = 'string';
update app.jobs set payload = (payload #>> '{}')::jsonb where jsonb_typeof(payload) = 'string';
