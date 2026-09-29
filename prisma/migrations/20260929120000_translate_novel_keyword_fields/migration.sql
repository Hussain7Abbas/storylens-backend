-- Existing novel and keyword text is Arabic: it moves to the *Ar columns.

-- Novel
DROP INDEX "Novel_name_key";
ALTER TABLE "Novel" RENAME COLUMN "name" TO "nameAr";
ALTER TABLE "Novel" RENAME COLUMN "description" TO "descriptionAr";
ALTER TABLE "Novel" ALTER COLUMN "nameAr" DROP NOT NULL;
ALTER TABLE "Novel" ADD COLUMN "nameEn" TEXT,
ADD COLUMN "descriptionEn" TEXT;
CREATE UNIQUE INDEX "Novel_nameAr_key" ON "Novel"("nameAr");
CREATE UNIQUE INDEX "Novel_nameEn_key" ON "Novel"("nameEn");

-- Keyword
DROP INDEX "Keyword_name_novelId_key";
DROP INDEX "Keyword_name_idx";
ALTER TABLE "Keyword" RENAME COLUMN "name" TO "nameAr";
ALTER TABLE "Keyword" ALTER COLUMN "nameAr" DROP NOT NULL;
ALTER TABLE "Keyword" ADD COLUMN "nameEn" TEXT;
CREATE UNIQUE INDEX "Keyword_nameAr_novelId_key" ON "Keyword"("nameAr", "novelId");
CREATE UNIQUE INDEX "Keyword_nameEn_novelId_key" ON "Keyword"("nameEn", "novelId");
CREATE INDEX "Keyword_nameAr_idx" ON "Keyword"("nameAr");
CREATE INDEX "Keyword_nameEn_idx" ON "Keyword"("nameEn");
