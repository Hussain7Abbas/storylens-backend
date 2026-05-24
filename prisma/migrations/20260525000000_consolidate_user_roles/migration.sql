-- CreateEnum
CREATE TYPE "Role" AS ENUM ('guest', 'user', 'admin');

-- AlterTable: Add new columns to User
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'user';
ALTER TABLE "User" ADD COLUMN "name_new" TEXT;

-- Backfill email from username for existing users (temporary)
UPDATE "User" SET "email" = username || '@placeholder.local', "name_new" = "name" WHERE "email" IS NULL;

-- Make email required and unique
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Drop old columns
ALTER TABLE "User" DROP COLUMN "phone";
ALTER TABLE "User" DROP COLUMN "birthDate";
ALTER TABLE "User" DROP COLUMN "gender";
ALTER TABLE "User" DROP COLUMN "name";
ALTER TABLE "User" RENAME COLUMN "name_new" TO "name";
ALTER TABLE "User" ALTER COLUMN "name" SET NOT NULL;

-- Add createdById to Novel
ALTER TABLE "Novel" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Novel" ADD CONSTRAINT "Novel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add createdById to Keyword
ALTER TABLE "Keyword" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add createdById to Replacement
ALTER TABLE "Replacement" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Replacement" ADD CONSTRAINT "Replacement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate Admin data to User table
INSERT INTO "User" ("id", "email", "username", "password", "name", "role", "createdAt", "updatedAt")
SELECT "id", "username" || '@admin.local', "username", "password", "name", 'admin'::"Role", "createdAt", "updatedAt"
FROM "Admin"
ON CONFLICT ("username") DO UPDATE SET "role" = 'admin'::"Role";

-- Drop Admin table and related
ALTER TABLE "File" DROP COLUMN IF EXISTS "adminId";
DROP TABLE IF EXISTS "Admin";

-- Drop Gender enum (no longer used)
DROP TYPE IF EXISTS "Gender";
