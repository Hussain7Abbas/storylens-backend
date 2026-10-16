-- AlterTable
ALTER TABLE "UserCategoryColor" DROP CONSTRAINT "UserCategoryColor_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "UserCategoryColor_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "UserNatureColor" DROP CONSTRAINT "UserNatureColor_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "UserNatureColor_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "UserCategoryColor_userId_categoryId_key" ON "UserCategoryColor"("userId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNatureColor_userId_natureId_key" ON "UserNatureColor"("userId", "natureId");

