-- DropForeignKey
ALTER TABLE "KeywordVersion" DROP CONSTRAINT "KeywordVersion_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "KeywordVersion" DROP CONSTRAINT "KeywordVersion_natureId_fkey";

-- AlterTable
ALTER TABLE "KeywordAlias" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "natureId" TEXT,
ADD COLUMN     "overrideStyle" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "KeywordVersion" ALTER COLUMN "categoryId" DROP NOT NULL,
ALTER COLUMN "natureId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "KeywordAlias" ADD CONSTRAINT "KeywordAlias_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "KeywordCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordAlias" ADD CONSTRAINT "KeywordAlias_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "KeywordNature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordVersion" ADD CONSTRAINT "KeywordVersion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "KeywordCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordVersion" ADD CONSTRAINT "KeywordVersion_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "KeywordNature"("id") ON DELETE SET NULL ON UPDATE CASCADE;
