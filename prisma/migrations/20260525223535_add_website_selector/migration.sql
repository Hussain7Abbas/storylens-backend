-- CreateTable
CREATE TABLE "WebsiteSelector" (
    "id" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "novelXpathValue" TEXT,
    "novelXpathRegex" TEXT,
    "novelUrlRegex" TEXT,
    "chapterXpathValue" TEXT,
    "chapterXpathRegex" TEXT,
    "chapterUrlRegex" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteSelector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteSelector_website_key" ON "WebsiteSelector"("website");

-- CreateIndex
CREATE INDEX "WebsiteSelector_website_idx" ON "WebsiteSelector"("website");
