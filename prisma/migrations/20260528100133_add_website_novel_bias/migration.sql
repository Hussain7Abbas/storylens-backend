-- CreateTable
CREATE TABLE "WebsiteNovelBias" (
    "id" TEXT NOT NULL,
    "websiteSelectorId" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "biasValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteNovelBias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteNovelBias_novelId_idx" ON "WebsiteNovelBias"("novelId");

-- CreateIndex
CREATE INDEX "WebsiteNovelBias_websiteSelectorId_idx" ON "WebsiteNovelBias"("websiteSelectorId");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteNovelBias_websiteSelectorId_novelId_key" ON "WebsiteNovelBias"("websiteSelectorId", "novelId");

-- AddForeignKey
ALTER TABLE "WebsiteNovelBias" ADD CONSTRAINT "WebsiteNovelBias_websiteSelectorId_fkey" FOREIGN KEY ("websiteSelectorId") REFERENCES "WebsiteSelector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteNovelBias" ADD CONSTRAINT "WebsiteNovelBias_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
