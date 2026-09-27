-- AlterTable
ALTER TABLE "KeywordCategory" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "KeywordNature" ADD COLUMN     "description" TEXT;

-- Backfill descriptions for the default categories and natures when they exist.
-- Either name column may hold the English or Arabic name, so both are matched against both.
-- Descriptions that are already set are kept.
UPDATE "KeywordCategory" AS c
SET "description" = v.description
FROM (VALUES
  ('Female', 'انثى', 'A female character (woman or girl), whatever her role in the story.'),
  ('Male', 'ذكر', 'A male character (man or boy) who is not the main character, whatever his role.'),
  ('Hero', 'بطل', 'The protagonist: the main character the story follows.'),
  ('Enemy', 'عدو', 'A male character who is a villain, rival, or antagonist opposing the main character.'),
  ('Friend', 'صديق', 'A male character who is an ally, companion, or supporter of the main character.'),
  ('Master', 'سيد', 'A teacher, mentor, elder, ruler, or other superior who guides or commands others.'),
  ('Skill', 'مهارة', 'A technique, ability, spell, martial art, or cultivation method, not a person.'),
  ('Item', 'اداة', 'A named object: weapon, artifact, treasure, pill, or other tool, not a person.'),
  ('Location', 'مكان', 'A place: city, country, sect, realm, mountain, building, or region.')
) AS v("nameEn", "nameAr", description)
WHERE c."description" IS NULL
  AND (
    lower(trim(c."nameEn")) IN (lower(v."nameEn"), v."nameAr")
    OR lower(trim(c."nameAr")) IN (lower(v."nameEn"), v."nameAr")
  );

UPDATE "KeywordNature" AS n
SET "description" = v.description
FROM (VALUES
  ('Enemy', 'عدو', 'Hostile to the main character: an opponent, rival, or threat.'),
  ('Friend', 'صديق', 'Friendly to the main character: an ally, family member, or helper.'),
  ('Hero', 'بطل', 'The main character himself, or the side he leads.')
) AS v("nameEn", "nameAr", description)
WHERE n."description" IS NULL
  AND (
    lower(trim(n."nameEn")) IN (lower(v."nameEn"), v."nameAr")
    OR lower(trim(n."nameAr")) IN (lower(v."nameEn"), v."nameAr")
  );
