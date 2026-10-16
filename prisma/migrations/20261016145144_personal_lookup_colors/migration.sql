-- CreateTable
CREATE TABLE "UserCategoryColor" (
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "color" TEXT NOT NULL,

    CONSTRAINT "UserCategoryColor_pkey" PRIMARY KEY ("userId","categoryId")
);

-- CreateTable
CREATE TABLE "UserNatureColor" (
    "userId" TEXT NOT NULL,
    "natureId" TEXT NOT NULL,
    "color" TEXT NOT NULL,

    CONSTRAINT "UserNatureColor_pkey" PRIMARY KEY ("userId","natureId")
);

-- AddForeignKey
ALTER TABLE "UserCategoryColor" ADD CONSTRAINT "UserCategoryColor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCategoryColor" ADD CONSTRAINT "UserCategoryColor_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "KeywordCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNatureColor" ADD CONSTRAINT "UserNatureColor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNatureColor" ADD CONSTRAINT "UserNatureColor_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "KeywordNature"("id") ON DELETE CASCADE ON UPDATE CASCADE;
