-- Aliases are named by "nameAr"/"nameEn" only, like keywords; the "name" column is removed.

-- 1. A name fills its script's column when that column is empty and no column
--    already holds it (the rule `aliasNames` applied on reads). Letters only:
--    Arabic digits and marks do not count, and Arabic wins in mixed names.
UPDATE "KeywordAlias"
SET "nameAr" = "name"
WHERE "nameAr" IS NULL
  AND "name" ~ '[ؠ-يٮٯٱ-ۓەۮۯۺ-ۼۿݐ-ݿࢠ-ࣉﭐ-ﴽﵐ-ﷻﹰ-ﻼ]'
  AND "name" IS DISTINCT FROM "nameEn";

UPDATE "KeywordAlias"
SET "nameEn" = "name"
WHERE "nameEn" IS NULL
  AND "name" !~ '[ؠ-يٮٯٱ-ۓەۮۯۺ-ۼۿݐ-ݿࢠ-ࣉﭐ-ﴽﵐ-ﷻﹰ-ﻼ]'
  AND "name" ~ '[A-Za-zªºÀ-ÖØ-öø-ɏḀ-ỿ]'
  AND "name" IS DISTINCT FROM "nameAr";

-- 2. A name without letters (digits, symbols) goes into every language column the
--    parent keyword is named in, so it keeps highlighting in those languages.
UPDATE "KeywordAlias" AS a
SET "nameAr" = a."name"
FROM "Keyword" AS k
WHERE k."id" = a."keywordId"
  AND k."nameAr" IS NOT NULL
  AND a."nameAr" IS NULL
  AND a."name" !~ '[ؠ-يٮٯٱ-ۓەۮۯۺ-ۼۿݐ-ݿࢠ-ࣉﭐ-ﴽﵐ-ﷻﹰ-ﻼ]'
  AND a."name" !~ '[A-Za-zªºÀ-ÖØ-öø-ɏḀ-ỿ]'
  AND a."name" IS DISTINCT FROM a."nameEn";

UPDATE "KeywordAlias" AS a
SET "nameEn" = a."name"
FROM "Keyword" AS k
WHERE k."id" = a."keywordId"
  AND k."nameEn" IS NOT NULL
  AND a."nameEn" IS NULL
  AND a."name" !~ '[ؠ-يٮٯٱ-ۓەۮۯۺ-ۼۿݐ-ݿࢠ-ࣉﭐ-ﴽﵐ-ﷻﹰ-ﻼ]'
  AND a."name" !~ '[A-Za-zªºÀ-ÖØ-öø-ɏḀ-ỿ]';

-- 3. Stop, listing the rows, when an alias would have no name or would break the
--    new per-language unique constraints. Fix that data first; never drop it.
DO $$
DECLARE
  problems TEXT;
BEGIN
  SELECT string_agg(line, E'\n') INTO problems FROM (
    SELECT format('alias %s (%L) has no name', "id", "name") AS line
    FROM "KeywordAlias"
    WHERE "nameAr" IS NULL AND "nameEn" IS NULL
    UNION ALL
    SELECT format('keyword %s has duplicate Arabic alias %L (aliases %s)', "keywordId", "nameAr", string_agg("id", ', '))
    FROM "KeywordAlias"
    WHERE "nameAr" IS NOT NULL
    GROUP BY "keywordId", "nameAr"
    HAVING count(*) > 1
    UNION ALL
    SELECT format('keyword %s has duplicate English alias %L (aliases %s)', "keywordId", "nameEn", string_agg("id", ', '))
    FROM "KeywordAlias"
    WHERE "nameEn" IS NOT NULL
    GROUP BY "keywordId", "nameEn"
    HAVING count(*) > 1
  ) AS found;

  IF problems IS NOT NULL THEN
    RAISE EXCEPTION E'Alias names need fixing before this migration:\n%', problems;
  END IF;
END $$;

-- 4. Contract: drop "name" and its unique index; names are unique per keyword in each language.
DROP INDEX "KeywordAlias_keywordId_name_key";
ALTER TABLE "KeywordAlias" DROP COLUMN "name";
CREATE UNIQUE INDEX "KeywordAlias_keywordId_nameAr_key" ON "KeywordAlias"("keywordId", "nameAr");
CREATE UNIQUE INDEX "KeywordAlias_keywordId_nameEn_key" ON "KeywordAlias"("keywordId", "nameEn");
