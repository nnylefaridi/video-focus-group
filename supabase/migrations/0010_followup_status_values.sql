-- Documents how followups.status (added in 0009) is used. Additive only; safe to run twice.
-- A question is saved as 'answering' and becomes 'done' once its answer is saved, or 'failed'
-- when the answer never came (the reviewer's call failed, or the server stopped mid-answer;
-- src/server/followups.ts marks those after 15 minutes). Answers are saved whole, as 'done'.
comment on column app.followups.status is 'Question: answering | done | failed. Answer: done.';
