-- One account may now use both APIs: `portal` + `roleId` become an
-- `isUser`/`userRoleId` pair and an `isAdmin`/`adminRoleId` pair. Sessions
-- record the API they were issued for, so a reader token never opens the
-- dashboard even when the account is also a dashboard user.

-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "isUser" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "userRoleId" TEXT,
ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "adminRoleId" TEXT;

UPDATE "User" SET
    "isUser" = ("portal" = 'user'),
    "isAdmin" = ("portal" = 'admin'),
    "userRoleId" = CASE WHEN "portal" = 'user' THEN "roleId" END,
    "adminRoleId" = CASE WHEN "portal" = 'admin' THEN "roleId" END;

-- AlterTable
ALTER TABLE "session" ADD COLUMN     "portal" "Portal" NOT NULL DEFAULT 'user';

UPDATE "session" SET "portal" = "User"."portal"
FROM "User" WHERE "User"."id" = "session"."userId";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "portal",
DROP COLUMN "roleId";

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_userRoleId_fkey" FOREIGN KEY ("userRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_adminRoleId_fkey" FOREIGN KEY ("adminRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
