-- Triggered feed inserts acquire one transaction-scoped lock before taking a
-- BIGSERIAL value. A later transaction cannot commit a higher cursor first.
CREATE OR REPLACE FUNCTION "sync_change_record"() RETURNS trigger AS $$
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

  PERFORM pg_advisory_xact_lock(20260930, 1);
  INSERT INTO "SyncChange" ("entity", "entityId", "novelId", "op", "at")
  VALUES (TG_ARGV[0], changed."id", novel, lower(TG_OP), clock_timestamp());
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Prisma can issue two writes inside the same millisecond. Ensure a revision
-- really changes, including writes from admin routes and bulk updates.
CREATE FUNCTION "sync_monotonic_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" := GREATEST(clock_timestamp(), OLD."updatedAt" + INTERVAL '1 millisecond');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Keyword_monotonic_updated_at" BEFORE UPDATE ON "Keyword"
  FOR EACH ROW EXECUTE FUNCTION "sync_monotonic_updated_at"();
CREATE TRIGGER "KeywordAlias_monotonic_updated_at" BEFORE UPDATE ON "KeywordAlias"
  FOR EACH ROW EXECUTE FUNCTION "sync_monotonic_updated_at"();
CREATE TRIGGER "KeywordVersion_monotonic_updated_at" BEFORE UPDATE ON "KeywordVersion"
  FOR EACH ROW EXECUTE FUNCTION "sync_monotonic_updated_at"();
CREATE TRIGGER "Replacement_monotonic_updated_at" BEFORE UPDATE ON "Replacement"
  FOR EACH ROW EXECUTE FUNCTION "sync_monotonic_updated_at"();
CREATE TRIGGER "KeywordCategory_monotonic_updated_at" BEFORE UPDATE ON "KeywordCategory"
  FOR EACH ROW EXECUTE FUNCTION "sync_monotonic_updated_at"();
CREATE TRIGGER "KeywordNature_monotonic_updated_at" BEFORE UPDATE ON "KeywordNature"
  FOR EACH ROW EXECUTE FUNCTION "sync_monotonic_updated_at"();
