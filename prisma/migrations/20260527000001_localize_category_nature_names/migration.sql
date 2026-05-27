-- AlterTable: add new columns first (nullable so existing rows are valid)
ALTER TABLE "KeywordCategory" ADD COLUMN "nameAr" TEXT;
ALTER TABLE "KeywordCategory" ADD COLUMN "nameEn" TEXT;

ALTER TABLE "KeywordNature" ADD COLUMN "nameAr" TEXT;
ALTER TABLE "KeywordNature" ADD COLUMN "nameEn" TEXT;

-- DataMigration: copy existing name into both localized fields
UPDATE "KeywordCategory" SET "nameAr" = name, "nameEn" = name;
UPDATE "KeywordNature" SET "nameAr" = name, "nameEn" = name;

-- AlterTable: drop the old name column after data is migrated
ALTER TABLE "KeywordCategory" DROP COLUMN "name";
ALTER TABLE "KeywordNature" DROP COLUMN "name";
