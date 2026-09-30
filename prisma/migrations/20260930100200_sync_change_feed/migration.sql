-- CreateTable
CREATE TABLE "SyncChange" (
    "seq" BIGSERIAL NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "novelId" TEXT,
    "op" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncChange_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "SyncChange_novelId_seq_idx" ON "SyncChange"("novelId", "seq");

-- CreateIndex
CREATE INDEX "SyncChange_entity_seq_idx" ON "SyncChange"("entity", "seq");

-- Records one change per row. TG_ARGV[0] is the entity name; TG_ARGV[1] says where
-- the novel comes from: 'self' (a novel), 'column' (its "novelId"), 'keyword' (the
-- parent keyword's "novelId") or 'none' (lookups). A child deleted in its keyword's
-- cascade finds no parent and is recorded without a novel; clients remove a deleted
-- keyword's children themselves.
CREATE FUNCTION "sync_change_record"() RETURNS trigger AS $$
DECLARE
  changed RECORD;
  novel TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    changed := OLD;
  ELSE
    changed := NEW;
  END IF;

  IF TG_ARGV[1] = 'self' THEN
    novel := changed."id";
  ELSIF TG_ARGV[1] = 'column' THEN
    novel := changed."novelId";
  ELSIF TG_ARGV[1] = 'keyword' THEN
    SELECT "novelId" INTO novel FROM "Keyword" WHERE "id" = changed."keywordId";
  ELSE
    novel := NULL;
  END IF;

  INSERT INTO "SyncChange" ("entity", "entityId", "novelId", "op")
  VALUES (TG_ARGV[0], changed."id", novel, lower(TG_OP));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Novel_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "Novel"
  FOR EACH ROW EXECUTE FUNCTION "sync_change_record"('novel', 'self');
CREATE TRIGGER "Keyword_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "Keyword"
  FOR EACH ROW EXECUTE FUNCTION "sync_change_record"('keyword', 'column');
CREATE TRIGGER "KeywordAlias_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "KeywordAlias"
  FOR EACH ROW EXECUTE FUNCTION "sync_change_record"('keywordAlias', 'keyword');
CREATE TRIGGER "KeywordVersion_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "KeywordVersion"
  FOR EACH ROW EXECUTE FUNCTION "sync_change_record"('keywordVersion', 'keyword');
CREATE TRIGGER "Replacement_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "Replacement"
  FOR EACH ROW EXECUTE FUNCTION "sync_change_record"('replacement', 'column');
CREATE TRIGGER "WebsiteNovelBias_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "WebsiteNovelBias"
  FOR EACH ROW EXECUTE FUNCTION "sync_change_record"('websiteNovelBias', 'column');
CREATE TRIGGER "KeywordCategory_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "KeywordCategory"
  FOR EACH ROW EXECUTE FUNCTION "sync_change_record"('keywordCategory', 'none');
CREATE TRIGGER "KeywordNature_sync_change" AFTER INSERT OR UPDATE OR DELETE ON "KeywordNature"
  FOR EACH ROW EXECUTE FUNCTION "sync_change_record"('keywordNature', 'none');
