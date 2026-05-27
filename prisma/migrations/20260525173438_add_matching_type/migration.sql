-- CreateEnum
CREATE TYPE "MatchingType" AS ENUM ('FULL', 'PARTIAL');

-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "matchingType" "MatchingType" NOT NULL DEFAULT 'FULL';

-- AlterTable
ALTER TABLE "Replacement" ADD COLUMN     "matchingType" "MatchingType" NOT NULL DEFAULT 'FULL';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'guest';
