/*
  Warnings:

  - Added the required column `novelId` to the `Replacement` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."Replacement" DROP CONSTRAINT "Replacement_keywordId_fkey";

-- AlterTable
ALTER TABLE "public"."Replacement" ADD COLUMN     "novelId" TEXT NOT NULL,
ALTER COLUMN "keywordId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."Replacement" ADD CONSTRAINT "Replacement_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "public"."Novel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Replacement" ADD CONSTRAINT "Replacement_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "public"."Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;
