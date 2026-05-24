-- Backfill slugs from name for existing novels
UPDATE "public"."Novel"
SET "slugs" = ARRAY["name"]
WHERE cardinality("slugs") = 0;
