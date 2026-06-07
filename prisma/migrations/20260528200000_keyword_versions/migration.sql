-- CreateEnum
CREATE TYPE "KeywordType" AS ENUM ('KEYWORD', 'ALIAS', 'VERSION');

-- AlterTable: add new columns with defaults first, then relax constraints
ALTER TABLE "Keyword"
  ADD COLUMN "type"            "KeywordType" NOT NULL DEFAULT 'KEYWORD',
  ADD COLUMN "startingChapter" INTEGER,
  ADD COLUMN "endingChapter"   INTEGER;

-- Make name, description, categoryId, natureId nullable
ALTER TABLE "Keyword"
  ALTER COLUMN "name"        DROP NOT NULL,
  ALTER COLUMN "description" DROP NOT NULL,
  ALTER COLUMN "categoryId"  DROP NOT NULL,
  ALTER COLUMN "natureId"    DROP NOT NULL;

-- Backfill: rows with parentId are ALIAS
UPDATE "Keyword" SET "type" = 'ALIAS' WHERE "parentId" IS NOT NULL;

-- Create VERSION rows for every root KEYWORD (type = KEYWORD)
-- Each gets startingChapter = 0, endingChapter = NULL, inheriting description/categoryId/natureId/imageId
INSERT INTO "Keyword" (
  id,
  type,
  name,
  description,
  "matchingType",
  "categoryId",
  "natureId",
  "imageId",
  "parentId",
  "startingChapter",
  "endingChapter",
  "novelId",
  "createdById",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  'VERSION'::"KeywordType",
  NULL,
  k.description,
  k."matchingType",
  k."categoryId",
  k."natureId",
  k."imageId",
  k.id,
  0,
  NULL,
  k."novelId",
  k."createdById",
  now(),
  now()
FROM "Keyword" k
WHERE k.type = 'KEYWORD';

-- Clear categoryId/natureId/imageId from ALIAS rows (they inherit from the parent's active VERSION)
UPDATE "Keyword"
SET "categoryId" = NULL,
    "natureId"   = NULL,
    "imageId"    = NULL
WHERE "type" = 'ALIAS';

-- Add new unique constraint for version sequencing (NULL parentId/startingChapter pairs are excluded by Postgres NULL semantics)
CREATE UNIQUE INDEX "Keyword_parentId_startingChapter_key" ON "Keyword"("parentId", "startingChapter");

-- Add new indexes
CREATE INDEX "Keyword_type_idx"         ON "Keyword"("type");
CREATE INDEX "Keyword_parentId_type_idx" ON "Keyword"("parentId", "type");
