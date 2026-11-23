-- The hypothesis of an experiment (user request of 2026-11-23): every experiment has a field
-- for its hypothesis, written when it is added and changed with the rest of its text.
--
-- The experiment guards already make a reviewed experiment final and a closed cycle
-- unchangeable, so the hypothesis follows the same rules. Existing experiments get an empty one.

ALTER TABLE experiments ADD COLUMN hypothesis text NOT NULL DEFAULT '';

GRANT UPDATE (hypothesis) ON experiments TO potencializador_app;
