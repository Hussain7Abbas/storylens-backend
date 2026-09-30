-- Stored text is plain from now on: the API trims input but no longer HTML-escapes it.
-- Decode the four entities `sanitize` used to write, once, in every column it wrote.
-- `&` was never escaped, so nothing else needs decoding.
CREATE FUNCTION pg_temp.storylens_decode(value TEXT) RETURNS TEXT AS $$
  SELECT replace(replace(replace(replace(value, '&#x27;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>')
$$ LANGUAGE SQL IMMUTABLE;

UPDATE "Novel" SET
  "nameAr" = pg_temp.storylens_decode("nameAr"),
  "nameEn" = pg_temp.storylens_decode("nameEn"),
  "descriptionAr" = pg_temp.storylens_decode("descriptionAr"),
  "descriptionEn" = pg_temp.storylens_decode("descriptionEn"),
  "context" = pg_temp.storylens_decode("context")
WHERE "nameAr" ~ '&(#x27|quot|lt|gt);' OR "nameEn" ~ '&(#x27|quot|lt|gt);' OR "descriptionAr" ~ '&(#x27|quot|lt|gt);' OR "descriptionEn" ~ '&(#x27|quot|lt|gt);' OR "context" ~ '&(#x27|quot|lt|gt);';

UPDATE "Chapter" SET
  "name" = pg_temp.storylens_decode("name"),
  "description" = pg_temp.storylens_decode("description")
WHERE "name" ~ '&(#x27|quot|lt|gt);' OR "description" ~ '&(#x27|quot|lt|gt);';

UPDATE "KeywordCategory" SET
  "nameAr" = pg_temp.storylens_decode("nameAr"),
  "nameEn" = pg_temp.storylens_decode("nameEn"),
  "description" = pg_temp.storylens_decode("description")
WHERE "nameAr" ~ '&(#x27|quot|lt|gt);' OR "nameEn" ~ '&(#x27|quot|lt|gt);' OR "description" ~ '&(#x27|quot|lt|gt);';

UPDATE "KeywordNature" SET
  "nameAr" = pg_temp.storylens_decode("nameAr"),
  "nameEn" = pg_temp.storylens_decode("nameEn"),
  "description" = pg_temp.storylens_decode("description")
WHERE "nameAr" ~ '&(#x27|quot|lt|gt);' OR "nameEn" ~ '&(#x27|quot|lt|gt);' OR "description" ~ '&(#x27|quot|lt|gt);';

UPDATE "Keyword" SET
  "nameAr" = pg_temp.storylens_decode("nameAr"),
  "nameEn" = pg_temp.storylens_decode("nameEn")
WHERE "nameAr" ~ '&(#x27|quot|lt|gt);' OR "nameEn" ~ '&(#x27|quot|lt|gt);';

UPDATE "KeywordAlias" SET
  "nameAr" = pg_temp.storylens_decode("nameAr"),
  "nameEn" = pg_temp.storylens_decode("nameEn"),
  "description" = pg_temp.storylens_decode("description")
WHERE "nameAr" ~ '&(#x27|quot|lt|gt);' OR "nameEn" ~ '&(#x27|quot|lt|gt);' OR "description" ~ '&(#x27|quot|lt|gt);';

UPDATE "KeywordVersion" SET
  "description" = pg_temp.storylens_decode("description")
WHERE "description" ~ '&(#x27|quot|lt|gt);';

UPDATE "Replacement" SET
  "from" = pg_temp.storylens_decode("from"),
  "to" = pg_temp.storylens_decode("to")
WHERE "from" ~ '&(#x27|quot|lt|gt);' OR "to" ~ '&(#x27|quot|lt|gt);';

UPDATE "User" SET
  "name" = pg_temp.storylens_decode("name")
WHERE "name" ~ '&(#x27|quot|lt|gt);';

UPDATE "Role" SET
  "name" = pg_temp.storylens_decode("name"),
  "description" = pg_temp.storylens_decode("description")
WHERE "name" ~ '&(#x27|quot|lt|gt);' OR "description" ~ '&(#x27|quot|lt|gt);';

UPDATE "Novel"
SET "slugs" = ARRAY(
  SELECT pg_temp.storylens_decode(slug)
  FROM unnest("slugs") WITH ORDINALITY AS s(slug, position)
  ORDER BY position
)
WHERE array_to_string("slugs", ' ') ~ '&(#x27|quot|lt|gt);';
