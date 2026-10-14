-- AlterTable
ALTER TABLE "KeywordAlias" ADD COLUMN     "descriptionAr" TEXT,
ADD COLUMN     "descriptionEn" TEXT;

-- AlterTable
ALTER TABLE "KeywordVersion" ADD COLUMN     "descriptionAr" TEXT,
ADD COLUMN     "descriptionEn" TEXT;

-- Preserve the legacy value and assign it by script rather than the name/UI language.
UPDATE "KeywordAlias"
SET "descriptionAr" = CASE WHEN description ~ '[ء-غف-يٮ-ٯٱ-ۓەۥ-ۦۮ-ۯݐ-ݿࢠ-ࢴࢶ-ࣇ]' THEN description ELSE NULL END,
    "descriptionEn" = CASE WHEN description ~ '[ء-غف-يٮ-ٯٱ-ۓەۥ-ۦۮ-ۯݐ-ݿࢠ-ࢴࢶ-ࣇ]' THEN NULL ELSE description END
WHERE description IS NOT NULL;

-- Preserve the legacy value and assign it by script rather than the name/UI language.
UPDATE "KeywordVersion"
SET "descriptionAr" = CASE WHEN description ~ '[ء-غف-يٮ-ٯٱ-ۓەۥ-ۦۮ-ۯݐ-ݿࢠ-ࢴࢶ-ࣇ]' THEN description ELSE NULL END,
    "descriptionEn" = CASE WHEN description ~ '[ء-غف-يٮ-ٯٱ-ۓەۥ-ۦۮ-ۯݐ-ݿࢠ-ࢴࢶ-ࣇ]' THEN NULL ELSE description END
WHERE description IS NOT NULL;
