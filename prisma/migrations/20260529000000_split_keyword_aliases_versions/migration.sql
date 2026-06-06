-- ============================================================
-- Step 1: Create KeywordAlias and KeywordVersion tables
-- ============================================================

CREATE TABLE "KeywordAlias" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "matchingType" "MatchingType" NOT NULL DEFAULT 'FULL',
  "keywordId"    TEXT NOT NULL,
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeywordAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeywordVersion" (
  "id"              TEXT NOT NULL,
  "description"     TEXT,
  "startingChapter" INTEGER NOT NULL,
  "endingChapter"   INTEGER,
  "categoryId"      TEXT NOT NULL,
  "natureId"        TEXT NOT NULL,
  "imageId"         TEXT,
  "keywordId"       TEXT NOT NULL,
  "createdById"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeywordVersion_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- Step 2: Migrate VERSION rows → KeywordVersion
-- ============================================================

INSERT INTO "KeywordVersion" (
  "id", "description", "startingChapter", "endingChapter",
  "categoryId", "natureId", "imageId", "keywordId",
  "createdById", "createdAt", "updatedAt"
)
SELECT
  k."id",
  k."description",
  COALESCE(k."startingChapter", 0),
  k."endingChapter",
  k."categoryId",
  k."natureId",
  k."imageId",
  k."parentId",
  k."createdById",
  k."createdAt",
  k."updatedAt"
FROM "Keyword" k
WHERE k."type" = 'VERSION'
  AND k."categoryId" IS NOT NULL
  AND k."natureId"   IS NOT NULL
  AND k."parentId"   IS NOT NULL;

-- ============================================================
-- Step 3: Migrate ALIAS rows → KeywordAlias
-- ============================================================

INSERT INTO "KeywordAlias" (
  "id", "name", "description", "matchingType",
  "keywordId", "createdById", "createdAt", "updatedAt"
)
SELECT
  k."id",
  k."name",
  k."description",
  k."matchingType",
  k."parentId",
  k."createdById",
  k."createdAt",
  k."updatedAt"
FROM "Keyword" k
WHERE k."type" = 'ALIAS'
  AND k."name"     IS NOT NULL
  AND k."parentId" IS NOT NULL;

-- ============================================================
-- Step 4: Delete ALIAS and VERSION rows from Keyword
-- ============================================================

DELETE FROM "Keyword" WHERE "type" IN ('ALIAS', 'VERSION');

-- ============================================================
-- Step 5: Drop old indexes and constraints on Keyword
-- ============================================================

DROP INDEX IF EXISTS "Keyword_parentId_startingChapter_key";
DROP INDEX IF EXISTS "Keyword_type_idx";
DROP INDEX IF EXISTS "Keyword_parentId_type_idx";
DROP INDEX IF EXISTS "Keyword_name_novelId_key";
DROP INDEX IF EXISTS "Keyword_name_idx";

ALTER TABLE "Keyword" DROP CONSTRAINT IF EXISTS "Keyword_parentId_fkey";

-- ============================================================
-- Step 6: Drop columns no longer needed on Keyword
-- ============================================================

ALTER TABLE "Keyword"
  DROP COLUMN "type",
  DROP COLUMN "parentId",
  DROP COLUMN "startingChapter",
  DROP COLUMN "endingChapter",
  DROP COLUMN "categoryId",
  DROP COLUMN "natureId",
  DROP COLUMN "description",
  DROP COLUMN "imageId";

-- ============================================================
-- Step 7: Make name NOT NULL and restore unique/index
-- ============================================================

ALTER TABLE "Keyword" ALTER COLUMN "name" SET NOT NULL;

CREATE UNIQUE INDEX "Keyword_name_novelId_key" ON "Keyword"("name", "novelId");
CREATE INDEX "Keyword_name_idx" ON "Keyword"("name");

-- ============================================================
-- Step 8: Add FKs, uniques, and indexes on new tables
-- ============================================================

ALTER TABLE "KeywordAlias"
  ADD CONSTRAINT "KeywordAlias_keywordId_fkey"
    FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordAlias"
  ADD CONSTRAINT "KeywordAlias_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "KeywordAlias_keywordId_name_key" ON "KeywordAlias"("keywordId", "name");
CREATE INDEX "KeywordAlias_keywordId_idx" ON "KeywordAlias"("keywordId");

ALTER TABLE "KeywordVersion"
  ADD CONSTRAINT "KeywordVersion_keywordId_fkey"
    FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordVersion"
  ADD CONSTRAINT "KeywordVersion_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "KeywordCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KeywordVersion"
  ADD CONSTRAINT "KeywordVersion_natureId_fkey"
    FOREIGN KEY ("natureId") REFERENCES "KeywordNature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KeywordVersion"
  ADD CONSTRAINT "KeywordVersion_imageId_fkey"
    FOREIGN KEY ("imageId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KeywordVersion"
  ADD CONSTRAINT "KeywordVersion_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "KeywordVersion_keywordId_startingChapter_key"
  ON "KeywordVersion"("keywordId", "startingChapter");

CREATE INDEX "KeywordVersion_keywordId_idx" ON "KeywordVersion"("keywordId");

-- ============================================================
-- Step 9: Update back-relations on KeywordCategory / KeywordNature
-- (FK constraints were on Keyword; now on KeywordVersion — already added above)
-- Drop old FKs that pointed from Keyword to category/nature/image/user
-- ============================================================

ALTER TABLE "Keyword" DROP CONSTRAINT IF EXISTS "Keyword_categoryId_fkey";
ALTER TABLE "Keyword" DROP CONSTRAINT IF EXISTS "Keyword_natureId_fkey";
ALTER TABLE "Keyword" DROP CONSTRAINT IF EXISTS "Keyword_imageId_fkey";

-- ============================================================
-- Step 10: Drop KeywordType enum
-- ============================================================

DROP TYPE IF EXISTS "KeywordType";
