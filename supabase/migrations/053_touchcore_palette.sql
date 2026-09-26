-- ============================================================================
-- 053 — Touchcore palette: the colours that live in the database
-- ============================================================================
--
-- The interface palette is in the stylesheets, but two tables carry colours of
-- their own, seeded once and then read back by the application:
--
--   core_values.accent_color       — offered to HR on the Core Values screen,
--                                    and carried into report exports
--   badge_definitions.accent_color — the level ramp
--
-- Those rows still hold the colours of the palette this release replaces, so a
-- seeded database would keep serving blue, teal, purple, orange and green from
-- under a red interface. The seed files are updated for a fresh install; this
-- migration brings an already-seeded one into line.
--
-- Rewritten by slug and by level, not by id, so it lands the same way on every
-- environment. Values HR has recoloured by hand are overwritten — that is the
-- point of a palette change — and anything HR has ADDED beyond the five is left
-- alone.
-- ============================================================================

UPDATE core_values SET accent_color = '#2A6EA8' WHERE slug = 'adaptable';
UPDATE core_values SET accent_color = '#5B6B78' WHERE slug = 'transparent';
UPDATE core_values SET accent_color = '#BE3A66' WHERE slug = 'collaborative';
UPDATE core_values SET accent_color = '#A25A0B' WHERE slug = 'innovative';
UPDATE core_values SET accent_color = '#C42A20' WHERE slug = 'accountable';

-- The badge ramp reads as one hue getting heavier with the level. Every step
-- clears 3.5:1 or better as text on white, which the amber it replaces did not.
UPDATE badge_definitions SET accent_color = '#E05A4E' WHERE level = 1;
UPDATE badge_definitions SET accent_color = '#D13A2E' WHERE level = 2;
UPDATE badge_definitions SET accent_color = '#C42A20' WHERE level = 3;
UPDATE badge_definitions SET accent_color = '#A2211A' WHERE level = 4;
UPDATE badge_definitions SET accent_color = '#7C1913' WHERE level = 5;

-- The column defaults were the old brand's blue and amber, so a value or badge
-- created without an explicit colour would reintroduce them one row at a time.
ALTER TABLE core_values       ALTER COLUMN accent_color SET DEFAULT '#C42A20';
ALTER TABLE badge_definitions ALTER COLUMN accent_color SET DEFAULT '#C42A20';
