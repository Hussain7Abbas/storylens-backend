-- Replace the fixed guest/user/admin enum with portals and permission roles.
-- Existing accounts keep their access: guests become the `guest` role, users
-- the `reader` role and admins the `moderator` role, all on the user portal.
-- The dashboard super admin is created by the seed.

-- The new "Role" table needs the name the old enum type holds.
ALTER TYPE "Role" RENAME TO "Role_old";

-- CreateEnum
CREATE TYPE "Portal" AS ENUM ('admin', 'user');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "portal" "Portal" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "portal" "Portal" NOT NULL,
    "group" TEXT NOT NULL,
    "method" TEXT,
    "path" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RolePermissions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RolePermissions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_slug_key" ON "Role"("slug");

-- CreateIndex
CREATE INDEX "Role_portal_idx" ON "Role"("portal");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "Permission_portal_idx" ON "Permission"("portal");

-- CreateIndex
CREATE INDEX "_RolePermissions_B_index" ON "_RolePermissions"("B");

-- System roles. Their permissions are granted when the server syncs its routes.
INSERT INTO "Role" ("id", "slug", "name", "description", "portal", "isSystem", "updatedAt") VALUES
    (gen_random_uuid()::text, 'super-admin', 'Super Admin', 'Full dashboard access. Always holds every admin permission.', 'admin', true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'guest', 'Guest', 'Anonymous extension install: read-only catalogue access.', 'user', true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'reader', 'Reader', 'Registered reader: manages their own keywords and replacements.', 'user', true, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'moderator', 'Moderator', 'Curates shared catalogue data from the extension.', 'user', true, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "User"
ADD COLUMN     "isGuest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portal" "Portal" NOT NULL DEFAULT 'user',
ADD COLUMN     "roleId" TEXT;

UPDATE "User" SET
    "isGuest" = ("role" = 'guest'),
    "roleId" = (
        SELECT "id" FROM "Role" WHERE "slug" = CASE "User"."role"
            WHEN 'guest' THEN 'guest'
            WHEN 'user' THEN 'reader'
            ELSE 'moderator'
        END
    );

ALTER TABLE "User" DROP COLUMN "role";

-- DropEnum
DROP TYPE "Role_old";

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermissions" ADD CONSTRAINT "_RolePermissions_A_fkey" FOREIGN KEY ("A") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermissions" ADD CONSTRAINT "_RolePermissions_B_fkey" FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
