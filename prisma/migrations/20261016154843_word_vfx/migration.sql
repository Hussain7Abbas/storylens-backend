-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "wordVfx" TEXT NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "KeywordAlias" ADD COLUMN     "wordVfx" TEXT NOT NULL DEFAULT 'NONE';
