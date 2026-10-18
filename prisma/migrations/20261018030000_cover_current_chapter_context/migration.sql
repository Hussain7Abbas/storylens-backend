-- Seed/update the shared cover template. Keep customized art direction; append
-- the new scene requirements once when they fit the existing 20,000-char cap.
-- Full-length custom templates remain intact: the extension also enforces the
-- current-chapter scene contract outside the editable template.
WITH templates AS (
 SELECT $cover_default$Create a cinematic chapter cover illustration of the single most valuable scene in the current chapter.
- Wait until the current chapter context is ready. Select the scene with the greatest narrative value: its strongest turning point, conflict, revelation or emotionally powerful moment, using both the chapter text and its current chapter context. Depict one coherent moment; do not merge different scenes.
- Enrich every depicted element from that selected scene in the current chapter context: character appearance, condition, clothing, equipment, pose, emotion and relationships; locations and objects; time, weather, lighting and environmental details. Use chapter text to resolve conflicts and never invent unsupported events or import another scene’s temporary state or a later state change.
- Preserve recognizable identities using keyword descriptions and available reference image URLs, adapted to the selected scene’s current appearance and action. Include only the characters, places and objects present in that scene; do not force every reference into the image.
- Use dramatic cinematic lighting, rich atmosphere, strong depth, expressive poses and detailed environments. Compose as a wide landscape chapter cover (16:9), without text.
- Use novel context only as background for genre, era, culture and world. Do not invent later events or spoilers.
- Draw an original illustration, not a copy of an official cover or adaptation. No titles, captions, logos, watermarks, signatures or UI.$cover_default$::text AS updated,
 $previous_cover$Create a cinematic chapter cover illustration centered on the most iconic, emotionally powerful scene in this chapter.
- Choose the scene that best captures the chapter's turning point, conflict or atmosphere. If several moments are essential, merge them into one coherent cinematic composition with a clear focal point; avoid an unrelated collage.
- Use dramatic cinematic lighting, rich atmosphere, strong depth, expressive poses and detailed environments. Compose as a wide landscape chapter cover (16:9), without text.
- Include only characters, places and objects that belong to the selected chapter scene(s). Use the provided keyword descriptions and reference image URLs for every depicted entity that has them: preserve recognizable faces, hair, clothing, species, weapons and distinguishing details, adapted to the action. Do not force every referenced entity into the scene.
- Treat the chapter as the source of events and the novel context as background for genre, era, culture and world. Do not invent later events or spoilers.
- Draw an original illustration, not a copy of an official cover or adaptation. No titles, captions, logos, watermarks, signatures or UI.$previous_cover$::text AS previous,
 $cover_requirements$Current chapter scene requirements:
- Generate only after the current chapter context has finished generating and is ready.
- Select the single most valuable scene using the chapter text and current chapter context together; do not merge different moments.
- Describe each depicted character, object and location using that selected scene’s observations in the current chapter context: appearance, condition, clothing, equipment, pose, emotion, relationships and environment, including time, weather and lighting.
- Preserve reference identities while following the selected scene’s state. Let chapter text resolve contradictions. Do not import other scenes, later state changes or events from other chapters.$cover_requirements$::text AS requirements
)
INSERT INTO "Config" ("id", "key", "value", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'AI_Chapter_Cover_Prompt', updated, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM templates
ON CONFLICT ("key") DO UPDATE SET
 "value" = CASE
   WHEN btrim("Config"."value") = '' OR btrim("Config"."value") = (SELECT btrim(previous) FROM templates)
     OR "Config"."value" = EXCLUDED."value" THEN EXCLUDED."value"
   WHEN strpos("Config"."value", (SELECT requirements FROM templates)) > 0 THEN "Config"."value"
   WHEN length("Config"."value") + length((SELECT requirements FROM templates)) + 2 <= 20000
     THEN "Config"."value" || E'\n\n' || (SELECT requirements FROM templates)
   ELSE "Config"."value"
 END,
 "updatedAt" = GREATEST(CURRENT_TIMESTAMP, "Config"."updatedAt" + INTERVAL '1 millisecond');
