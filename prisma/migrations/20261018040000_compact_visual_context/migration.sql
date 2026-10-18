-- Seed compact visual-only instructions without discarding customized art/extraction priorities.
WITH templates AS (
 SELECT $context_default$Extract the smallest useful visual continuity context for the current chapter of a web novel.
Keep only facts useful for future image generation: recognizable appearance, visible condition/injuries, clothing, equipment, spatial relationships, environment and lighting. Omit biography, dialogue, power rankings, plot commentary and nonvisual relationship history. Record only elements actually present in each scene, in narrative order; unknown fields are empty strings or arrays. Never invent details.
Use one short visual summary (maximum 400 characters). Keep scene, environment and entity descriptions under 160 characters each, evidence under 80, and equipment/relations to at most 8 concise visual items. Avoid repeated prose and keep the complete JSON under 60,000 characters. Pose, emotion and spatial relationships belong only to their scene and only when useful to draw it.
Use canonical keyword UUIDs and keyword:<UUID> keys for registered names and aliases; otherwise use stable name:<normalized lowercase name> keys. Aliases are one identity. Scene ids must be unique.
Use only the nearest available previous chapter as the normal continuity reference. Additional earlier chapter contexts are supplied together only for elements returning now. Never use next chapters. Earlier context may preserve established visual identity and lasting appearance/condition/equipment of elements actually present now, unless contradicted by current text; it cannot establish current presence, action, pose, mood or location.
stateChanges contains only new, explicit, lasting changes useful to images (injuries/healing, visible transformations, clothing/equipment damage/repair). Do not repeat older changes. Null explicitly clears a state; unknown is not null. Use the exact entityKey and sceneId and stable visual field paths. Do not persist dream/flashback changes unless still true at this chapter’s ending.
Absent elements leave active tracking after 10 chapters. Track lastSeenChapter only, never a missing-chapter count, and never copy absent elements into scenes. Keep evidence minimal and use your own words.$context_default$::text AS updated,
 $previous_context$Extract a faithful visual continuity context for the current chapter of a web novel.
Keep scenes in narrative order, including flashbacks and changes of location/time. Record who is actually present in each scene. Use empty strings for unknown observations and [] for no items; never invent details. Capture every named entity relevant to the chapter, including unregistered entities.
Use the canonical keyword UUID and entityKey keyword:<UUID> for a known name or any of its aliases. For other entities use a stable name:<normalized lowercase name> key. Keep identities consistent across scenes. Never treat aliases as separate people. Scene ids must be unique.
stateChanges contains only explicitly established lasting changes (injuries, healing, clothing/equipment changes, damage/repair, transformations); omit temporary poses, moods and guesses. Null is an explicitly cleared state, never an unknown. Reference the exact entityKey and sceneId where the change happens. Use stable field paths for the same fact. Flashbacks, dreams and hypothetical scenes belong in scene observations; include their changes in stateChanges only when the chapter explicitly establishes that state as still true at its ending. Do not copy assumed facts from other chapters. Keep evidence excerpts short. Summarize in your own words.$previous_context$::text AS previous,
 $context_requirements$Compact visual continuity requirements:
- Keep only facts useful for future images: appearance, visible condition, clothing/equipment, spatial composition, environment and lighting. Omit biography, dialogue, rankings and nonvisual history. Keep descriptions brief and JSON under 60,000 characters.
- Use the one nearest previous chapter for tracking, plus bulk-supplied earlier contexts only for elements returning now. Never use future chapters. Current text controls presence, action and new changes; earlier sources preserve established lasting visual facts only, never pose/mood/location.
- Record only elements present in current scenes. Drop absent elements from active tracking after 10 chapters; track only lastSeenChapter, never a missing count. Record only new explicit visually useful lasting changes and avoid repeated prose.$context_requirements$::text AS requirements
)
INSERT INTO "Config" ("id", "key", "value", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'AI_Chapter_Context_Prompt', updated, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM templates
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
