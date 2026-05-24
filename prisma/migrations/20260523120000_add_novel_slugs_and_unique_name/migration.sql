-- DropIndex
DROP INDEX "public"."Novel_name_idx";

-- AlterTable
ALTER TABLE "public"."Novel" ADD COLUMN "slugs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "Novel_name_key" ON "public"."Novel"("name");
