ALTER TABLE "Keyword" ADD COLUMN "fuzzyMatchArabicCharacters" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "KeywordAlias" ADD COLUMN "fuzzyMatchArabicCharacters" BOOLEAN NOT NULL DEFAULT true;
