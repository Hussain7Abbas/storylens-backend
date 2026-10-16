BEGIN;

CREATE TYPE "WordVfx" AS ENUM ('NONE', 'SPARKLES', 'HEAT', 'SHAKING', 'GLITCHING');

-- Preserve the existing word effect when changing its storage type.
ALTER TABLE "Keyword"
  ADD COLUMN "wordVfxColor" TEXT,
  ALTER COLUMN "wordVfx" DROP DEFAULT,
  ALTER COLUMN "wordVfx" TYPE "WordVfx" USING "wordVfx"::"WordVfx",
  ALTER COLUMN "wordVfx" SET DEFAULT 'NONE';

-- Preserve the existing word effect when changing its storage type.
ALTER TABLE "KeywordAlias"
  ADD COLUMN "wordVfxColor" TEXT,
  ALTER COLUMN "wordVfx" DROP DEFAULT,
  ALTER COLUMN "wordVfx" TYPE "WordVfx" USING "wordVfx"::"WordVfx",
  ALTER COLUMN "wordVfx" SET DEFAULT 'NONE';

COMMIT;
