-- Deduplicate keywords by (name, novelId), reassigning relations to the oldest row
WITH ranked AS (
  SELECT
    id,
    "novelId",
    name,
    ROW_NUMBER() OVER (
      PARTITION BY "novelId", name
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Keyword"
),
keepers AS (
  SELECT id, "novelId", name
  FROM ranked
  WHERE rn = 1
),
dupes AS (
  SELECT
    duplicate.id AS duplicate_id,
    keeper.id AS keeper_id
  FROM ranked duplicate
  INNER JOIN keepers keeper
    ON keeper."novelId" = duplicate."novelId"
    AND keeper.name = duplicate.name
  WHERE duplicate.rn > 1
)
UPDATE "KeywordsChapters" kc
SET "keywordId" = d.keeper_id
FROM dupes d
WHERE kc."keywordId" = d.duplicate_id;

WITH ranked AS (
  SELECT
    id,
    "novelId",
    name,
    ROW_NUMBER() OVER (
      PARTITION BY "novelId", name
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Keyword"
),
keepers AS (
  SELECT id, "novelId", name
  FROM ranked
  WHERE rn = 1
),
dupes AS (
  SELECT
    duplicate.id AS duplicate_id,
    keeper.id AS keeper_id
  FROM ranked duplicate
  INNER JOIN keepers keeper
    ON keeper."novelId" = duplicate."novelId"
    AND keeper.name = duplicate.name
  WHERE duplicate.rn > 1
)
UPDATE "Replacement" rep
SET "keywordId" = d.keeper_id
FROM dupes d
WHERE rep."keywordId" = d.duplicate_id;

WITH ranked AS (
  SELECT
    id,
    "novelId",
    name,
    ROW_NUMBER() OVER (
      PARTITION BY "novelId", name
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Keyword"
),
keepers AS (
  SELECT id, "novelId", name
  FROM ranked
  WHERE rn = 1
),
dupes AS (
  SELECT
    duplicate.id AS duplicate_id,
    keeper.id AS keeper_id
  FROM ranked duplicate
  INNER JOIN keepers keeper
    ON keeper."novelId" = duplicate."novelId"
    AND keeper.name = duplicate.name
  WHERE duplicate.rn > 1
)
UPDATE "Keyword" child
SET "parentId" = d.keeper_id
FROM dupes d
WHERE child."parentId" = d.duplicate_id;

WITH ranked AS (
  SELECT
    id,
    "novelId",
    name,
    ROW_NUMBER() OVER (
      PARTITION BY "novelId", name
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Keyword"
),
keepers AS (
  SELECT id, "novelId", name
  FROM ranked
  WHERE rn = 1
),
dupes AS (
  SELECT
    duplicate.id AS duplicate_id,
    keeper.id AS keeper_id
  FROM ranked duplicate
  INNER JOIN keepers keeper
    ON keeper."novelId" = duplicate."novelId"
    AND keeper.name = duplicate.name
  WHERE duplicate.rn > 1
)
DELETE FROM "Keyword" kw
USING dupes d
WHERE kw.id = d.duplicate_id;

CREATE UNIQUE INDEX "Keyword_name_novelId_key" ON "Keyword"("name", "novelId");
