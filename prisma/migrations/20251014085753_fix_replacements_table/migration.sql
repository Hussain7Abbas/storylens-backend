/*
  Warnings:

  - You are about to drop the column `replacement` on the `Replacement` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[from,novelId]` on the table `Replacement` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `from` to the `Replacement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `to` to the `Replacement` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."Chapter" DROP CONSTRAINT "Chapter_novelId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Keyword" DROP CONSTRAINT "Keyword_novelId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Replacement" DROP CONSTRAINT "Replacement_novelId_fkey";

-- AlterTable
ALTER TABLE "public"."Replacement" DROP COLUMN "replacement",
ADD COLUMN     "from" TEXT NOT NULL,
ADD COLUMN     "to" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Replacement_from_novelId_key" ON "public"."Replacement"("from", "novelId");

-- AddForeignKey
ALTER TABLE "public"."Chapter" ADD CONSTRAINT "Chapter_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "public"."Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Keyword" ADD CONSTRAINT "Keyword_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "public"."Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Replacement" ADD CONSTRAINT "Replacement_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "public"."Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
