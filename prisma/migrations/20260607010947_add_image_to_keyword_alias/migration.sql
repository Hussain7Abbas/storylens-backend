-- AlterTable
ALTER TABLE "KeywordAlias" ADD COLUMN     "imageId" TEXT;

-- AddForeignKey
ALTER TABLE "KeywordAlias" ADD CONSTRAINT "KeywordAlias_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
