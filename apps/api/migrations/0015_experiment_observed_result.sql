-- The observed result of an experiment (user request of 2026-11-23): when the panel reviews
-- an experiment it records what happened, facts and data, in an open field next to the
-- learnings. The closed result (consolidated, not consolidated, discarded) keeps its rules.
--
-- The review guard already makes a reviewed experiment final, so the observed result is
-- written with the review and never after it. Existing experiments get an empty one.

ALTER TABLE experiments ADD COLUMN observed_result text NOT NULL DEFAULT '';

GRANT UPDATE (observed_result) ON experiments TO potencializador_app;
