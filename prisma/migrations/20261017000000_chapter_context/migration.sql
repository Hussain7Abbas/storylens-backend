BEGIN;
-- DropForeignKey
ALTER TABLE "ChapterCover" DROP CONSTRAINT "ChapterCover_novelId_fkey";

-- DropForeignKey
ALTER TABLE "ChapterCover" DROP CONSTRAINT "ChapterCover_imageId_fkey";

-- DropForeignKey
ALTER TABLE "ChapterCover" DROP CONSTRAINT "ChapterCover_createdById_fkey";

-- AlterTable
ALTER TABLE "Chapter"
ADD COLUMN     "context" JSONB,
ADD COLUMN     "contextCreatedById" TEXT,
ADD COLUMN     "contextGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "contextHash" TEXT,
ADD COLUMN     "contextLanguage" TEXT,
ADD COLUMN     "contextLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "contextLeaseHash" TEXT,
ADD COLUMN     "contextLeaseToken" TEXT,
ADD COLUMN     "coverCreatedById" TEXT,
ADD COLUMN     "coverLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "coverLeaseToken" TEXT,
ADD COLUMN     "imageId" TEXT,
ALTER COLUMN "name" SET DEFAULT '';



-- CreateTable
CREATE TABLE "ChapterMention" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "entityKey" TEXT NOT NULL,
    "keywordId" TEXT,
    "name" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ChapterMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChapterMention_novelId_entityKey_chapterNumber_idx" ON "ChapterMention"("novelId", "entityKey", "chapterNumber");

-- CreateIndex
CREATE INDEX "ChapterMention_novelId_chapterNumber_idx" ON "ChapterMention"("novelId", "chapterNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterMention_chapterId_entityKey_key" ON "ChapterMention"("chapterId", "entityKey");

-- Preserve descriptions inside structured context before removing the old column.
UPDATE "Chapter" SET "context" = jsonb_build_object('schemaVersion', 1, 'summary', "description", 'scenes', '[]'::jsonb, 'stateChanges', '[]'::jsonb)
WHERE "description" IS NOT NULL AND length(trim("description")) > 0;

-- Canonicalize duplicate manually catalogued chapters without losing keyword links.
CREATE TEMP TABLE chapter_merge ON COMMIT DROP AS
SELECT id, first_value(id) OVER (PARTITION BY "novelId", number ORDER BY "createdAt", id) AS keep_id FROM "Chapter";
UPDATE "KeywordsChapters" k SET "chapterId" = m.keep_id FROM chapter_merge m WHERE k."chapterId" = m.id AND m.id <> m.keep_id;
UPDATE "Chapter" keep SET context = old.context FROM "Chapter" old, chapter_merge m
WHERE keep.id = m.keep_id AND old.id = m.id AND keep.context IS NULL AND old.context IS NOT NULL;
DELETE FROM "Chapter" c USING chapter_merge m WHERE c.id = m.id AND m.id <> m.keep_id;
ALTER TABLE "Chapter" DROP COLUMN "description";

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_novelId_number_key" ON "Chapter"("novelId", "number");

-- Move artwork and active leases before deleting ChapterCover. File ids preserve URLs and ownership.
INSERT INTO "Chapter" (id, name, number, "novelId", "imageId", "coverCreatedById", "coverLeaseToken", "coverLeaseExpiresAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, '', "chapterNumber", "novelId", "imageId", "createdById", "leaseToken", "leaseExpiresAt", "createdAt", "updatedAt" FROM "ChapterCover"
ON CONFLICT ("novelId", number) DO UPDATE SET "imageId" = EXCLUDED."imageId", "coverCreatedById" = EXCLUDED."coverCreatedById", "coverLeaseToken" = EXCLUDED."coverLeaseToken", "coverLeaseExpiresAt" = EXCLUDED."coverLeaseExpiresAt";
DROP TABLE "ChapterCover";

INSERT INTO "AiFeaturePrice" (key, "nameEn", "nameAr", "descriptionEn", "descriptionAr", lenses, enabled, "maxPromptChars", "maxOutputTokens", "sortOrder", "updatedAt")
VALUES ('chapter_context', 'Chapter context', 'سياق الفصل', 'Structured chapter scenes, entity observations and continuity changes.', 'مشاهد الفصل وحالات الشخصيات وتغيّرات الاستمرارية.', 1, true, 180000, 12000, 35, CURRENT_TIMESTAMP);

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_contextCreatedById_fkey" FOREIGN KEY ("contextCreatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_coverCreatedById_fkey" FOREIGN KEY ("coverCreatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterMention" ADD CONSTRAINT "ChapterMention_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterMention" ADD CONSTRAINT "ChapterMention_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
