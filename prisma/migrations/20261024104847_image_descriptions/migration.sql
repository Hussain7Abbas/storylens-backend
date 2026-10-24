-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN     "imageDescription" TEXT;

-- AlterTable
ALTER TABLE "KeywordAlias" ADD COLUMN     "imageDescription" TEXT;

-- AlterTable
ALTER TABLE "KeywordVersion" ADD COLUMN     "imageDescription" TEXT;

-- Backfill before enabling dual writes. Preserve descriptions for rollback/older API instances.
UPDATE "Chapter" SET "imageDescription" = "imagePrompt";
UPDATE "KeywordAlias" SET "imageDescription" = "imagePrompt";
UPDATE "KeywordVersion" SET "imageDescription" = "imagePrompt";

CREATE FUNCTION storylens_sync_image_description() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."imageDescription" := COALESCE(NEW."imageDescription", NEW."imagePrompt");
    NEW."imagePrompt" := NEW."imageDescription";
  ELSIF NEW."imageDescription" IS DISTINCT FROM OLD."imageDescription" THEN
    NEW."imagePrompt" := NEW."imageDescription";
  ELSIF NEW."imagePrompt" IS DISTINCT FROM OLD."imagePrompt" THEN
    NEW."imageDescription" := NEW."imagePrompt";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER image_description_compat BEFORE INSERT OR UPDATE ON "Chapter"
FOR EACH ROW EXECUTE FUNCTION storylens_sync_image_description();
CREATE TRIGGER image_description_compat BEFORE INSERT OR UPDATE ON "KeywordAlias"
FOR EACH ROW EXECUTE FUNCTION storylens_sync_image_description();
CREATE TRIGGER image_description_compat BEFORE INSERT OR UPDATE ON "KeywordVersion"
FOR EACH ROW EXECUTE FUNCTION storylens_sync_image_description();
