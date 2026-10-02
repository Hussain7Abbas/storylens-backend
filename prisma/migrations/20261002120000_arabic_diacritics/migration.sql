-- Keyword and alias names are stored without Arabic diacritics (حركات): the
-- same marks as `src/utils/arabic.ts` (tatweel, U+064B–U+0652, U+0656–U+065F,
-- the dagger alif and the Quranic marks; hamza and madda marks stay). Names are
-- unique per novel (keywords) and per keyword (aliases), so when several names
-- strip to the same letters only one is changed (one that already has none, or
-- else the oldest); the extension matcher ignores diacritics either way.
CREATE FUNCTION "strip_arabic_diacritics"("value" TEXT) RETURNS TEXT AS $$
  SELECT NULLIF(btrim(normalize(regexp_replace(normalize("value", NFC), '[' || chr(1600) || chr(1611) || '-' || chr(1618) || chr(1622) || '-' || chr(1631) || chr(1648) || chr(1750) || '-' || chr(1756) || chr(1759) || '-' || chr(1764) || chr(1767) || chr(1768) || chr(1770) || '-' || chr(1773) || ']', '', 'g'), NFC)), '');
$$ LANGUAGE sql IMMUTABLE;

WITH "stripped" AS (
  SELECT "id", "strip_arabic_diacritics"("nameAr") AS "name",
    row_number() OVER (
      PARTITION BY "novelId", "strip_arabic_diacritics"("nameAr")
      ORDER BY ("nameAr" = "strip_arabic_diacritics"("nameAr")) DESC, "createdAt", "id"
    ) AS "rank"
  FROM "Keyword" WHERE "nameAr" IS NOT NULL
)
UPDATE "Keyword" AS "row" SET "nameAr" = "stripped"."name"
FROM "stripped"
WHERE "row"."id" = "stripped"."id" AND "stripped"."rank" = 1
  AND "stripped"."name" IS NOT NULL AND "row"."nameAr" <> "stripped"."name";

WITH "stripped" AS (
  SELECT "id", "strip_arabic_diacritics"("nameEn") AS "name",
    row_number() OVER (
      PARTITION BY "novelId", "strip_arabic_diacritics"("nameEn")
      ORDER BY ("nameEn" = "strip_arabic_diacritics"("nameEn")) DESC, "createdAt", "id"
    ) AS "rank"
  FROM "Keyword" WHERE "nameEn" IS NOT NULL
)
UPDATE "Keyword" AS "row" SET "nameEn" = "stripped"."name"
FROM "stripped"
WHERE "row"."id" = "stripped"."id" AND "stripped"."rank" = 1
  AND "stripped"."name" IS NOT NULL AND "row"."nameEn" <> "stripped"."name";

WITH "stripped" AS (
  SELECT "id", "strip_arabic_diacritics"("nameAr") AS "name",
    row_number() OVER (
      PARTITION BY "keywordId", "strip_arabic_diacritics"("nameAr")
      ORDER BY ("nameAr" = "strip_arabic_diacritics"("nameAr")) DESC, "createdAt", "id"
    ) AS "rank"
  FROM "KeywordAlias" WHERE "nameAr" IS NOT NULL
)
UPDATE "KeywordAlias" AS "row" SET "nameAr" = "stripped"."name"
FROM "stripped"
WHERE "row"."id" = "stripped"."id" AND "stripped"."rank" = 1
  AND "stripped"."name" IS NOT NULL AND "row"."nameAr" <> "stripped"."name";

WITH "stripped" AS (
  SELECT "id", "strip_arabic_diacritics"("nameEn") AS "name",
    row_number() OVER (
      PARTITION BY "keywordId", "strip_arabic_diacritics"("nameEn")
      ORDER BY ("nameEn" = "strip_arabic_diacritics"("nameEn")) DESC, "createdAt", "id"
    ) AS "rank"
  FROM "KeywordAlias" WHERE "nameEn" IS NOT NULL
)
UPDATE "KeywordAlias" AS "row" SET "nameEn" = "stripped"."name"
FROM "stripped"
WHERE "row"."id" = "stripped"."id" AND "stripped"."rank" = 1
  AND "stripped"."name" IS NOT NULL AND "row"."nameEn" <> "stripped"."name";

DROP FUNCTION "strip_arabic_diacritics"(TEXT);
