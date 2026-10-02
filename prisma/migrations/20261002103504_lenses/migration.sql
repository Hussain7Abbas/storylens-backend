-- CreateEnum
CREATE TYPE "LensTransactionType" AS ENUM ('TRIAL_GIFT', 'ADMIN_GIFT', 'ADMIN_ADJUSTMENT', 'TOP_UP', 'AI_CHARGE', 'AI_REFUND');

-- CreateEnum
CREATE TYPE "BillingRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiActionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('WHATSAPP', 'TELEGRAM');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lensBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LensTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LensTransactionType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "billingRequestId" TEXT,
    "aiActionId" TEXT,
    "aiFeature" TEXT,
    "createdById" TEXT,
    "websiteSeenAt" TIMESTAMP(3),
    "extensionSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LensTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT NOT NULL,
    "lenses" INTEGER NOT NULL,
    "unitPriceUsd" DECIMAL(12,6) NOT NULL,
    "totalUsd" DECIMAL(12,2) NOT NULL,
    "status" "BillingRequestStatus" NOT NULL DEFAULT 'PENDING',
    "contactChannel" "ContactChannel" NOT NULL,
    "contactHandle" TEXT NOT NULL,
    "note" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "rejectionReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiFeaturePrice" (
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "descriptionAr" TEXT,
    "lenses" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxPromptChars" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiFeaturePrice_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AiAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "status" "AiActionStatus" NOT NULL DEFAULT 'RUNNING',
    "lensesCharged" INTEGER NOT NULL,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "novelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "step" TEXT NOT NULL DEFAULT 'main',
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "costUsd" DECIMAL(12,6),
    "durationMs" INTEGER NOT NULL,
    "providerId" TEXT,
    "dataPolicy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LensTransaction_idempotencyKey_key" ON "LensTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LensTransaction_userId_createdAt_idx" ON "LensTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LensTransaction_type_createdAt_idx" ON "LensTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "BillingRequest_status_createdAt_idx" ON "BillingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BillingRequest_userId_createdAt_idx" ON "BillingRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAction_userId_createdAt_idx" ON "AiAction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAction_status_updatedAt_idx" ON "AiAction"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AiAction_feature_createdAt_idx" ON "AiAction"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiCall_actionId_idx" ON "AiCall"("actionId");

-- CreateIndex
CREATE INDEX "AiCall_createdAt_idx" ON "AiCall"("createdAt");

-- AddForeignKey
ALTER TABLE "LensTransaction" ADD CONSTRAINT "LensTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LensTransaction" ADD CONSTRAINT "LensTransaction_billingRequestId_fkey" FOREIGN KEY ("billingRequestId") REFERENCES "BillingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LensTransaction" ADD CONSTRAINT "LensTransaction_aiActionId_fkey" FOREIGN KEY ("aiActionId") REFERENCES "AiAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LensTransaction" ADD CONSTRAINT "LensTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRequest" ADD CONSTRAINT "BillingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRequest" ADD CONSTRAINT "BillingRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAction" ADD CONSTRAINT "AiAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "AiAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Balances never go negative; every ledger row changes something; requests ask for lenses.
ALTER TABLE "User" ADD CONSTRAINT "User_lensBalance_nonnegative" CHECK ("lensBalance" >= 0);
ALTER TABLE "LensTransaction" ADD CONSTRAINT "LensTransaction_delta_nonzero" CHECK ("delta" <> 0);
ALTER TABLE "BillingRequest" ADD CONSTRAINT "BillingRequest_lenses_positive" CHECK ("lenses" > 0);

-- One pricing record per AI feature (the keys are a contract with the clients).
INSERT INTO "AiFeaturePrice" ("key", "nameEn", "nameAr", "descriptionEn", "descriptionAr", "lenses", "enabled", "maxPromptChars", "maxOutputTokens", "sortOrder", "updatedAt") VALUES
  ('page_summary', 'Summarize page', 'تلخيص الصفحة', 'A short summary of the page you are reading.', 'ملخص قصير للصفحة التي تقرؤها.', 2, true, 64000, 1200, 10, CURRENT_TIMESTAMP),
  ('keyword_suggestion', 'AI keyword suggestion', 'اقتراح الكلمة بالذكاء الاصطناعي', 'Describes a picked name and suggests its category and nature.', 'يصف الاسم المحدد ويقترح تصنيفه وطبيعته.', 1, true, 32000, 800, 20, CURRENT_TIMESTAMP),
  ('chapter_extraction', 'Extract chapter characters', 'استخراج شخصيات الفصل', 'Lists the new characters of the open chapter.', 'يعرض الشخصيات الجديدة في الفصل المفتوح.', 4, true, 200000, 8000, 30, CURRENT_TIMESTAMP),
  ('character_image', 'Character image', 'صورة الشخصية', 'Draws an original illustration of a character.', 'يرسم صورة أصلية للشخصية.', 3, true, 24000, 400, 40, CURRENT_TIMESTAMP),
  ('novel_context', 'Novel background research', 'البحث عن خلفية الرواية', 'Searches the web once for a novel''s setting and main cast.', 'يبحث في الويب مرة واحدة عن عالم الرواية وشخصياتها الرئيسية.', 0, true, 8000, 1000, 50, CURRENT_TIMESTAMP),
  ('selector_detection', 'Website selector detection', 'اكتشاف محددات الموقع', 'Finds the novel and chapter selectors of a reading site.', 'يكتشف محددات الرواية والفصل في موقع القراءة.', 0, true, 60000, 2000, 60, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Billing defaults; existing values are kept.
INSERT INTO "Config" ("id", "key", "value", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Lens_Price_USD', '0.01', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Lens_Trial_Gift', '10', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Lens_Request_Min', '100', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Lens_Request_Max', '50000', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Lens_Pending_Requests_Max', '3', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'AI_Cloud_Enabled', 'false', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'AI_Text_Model', 'google/gemini-2.5-flash', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'AI_Image_Model', 'bytedance-seed/seedream-5-0-flash', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
