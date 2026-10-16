-- CreateTable
CREATE TABLE "ChapterCover" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "imageId" TEXT,
    "createdById" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChapterCover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChapterCover_novelId_chapterNumber_key" ON "ChapterCover"("novelId", "chapterNumber");

-- AddForeignKey
ALTER TABLE "ChapterCover" ADD CONSTRAINT "ChapterCover_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterCover" ADD CONSTRAINT "ChapterCover_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterCover" ADD CONSTRAINT "ChapterCover_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A chapter cover includes a longer scene-selection brief and one image.
INSERT INTO "AiFeaturePrice" ("key", "nameEn", "nameAr", "descriptionEn", "descriptionAr", "lenses", "enabled", "maxPromptChars", "maxOutputTokens", "sortOrder", "updatedAt")
VALUES ('chapter_cover', 'Chapter cover image', 'صورة غلاف الفصل', 'Draws a cinematic chapter scene using novel context and keyword references.', 'يرسم مشهداً سينمائياً للفصل باستخدام سياق الرواية ومراجع الكلمات المفتاحية.', 3, true, 180000, 1600, 45, CURRENT_TIMESTAMP);
