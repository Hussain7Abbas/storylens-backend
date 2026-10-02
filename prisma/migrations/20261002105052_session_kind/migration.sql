-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('bearer', 'web');

-- AlterTable
ALTER TABLE "session" ADD COLUMN     "kind" "SessionKind" NOT NULL DEFAULT 'bearer';
