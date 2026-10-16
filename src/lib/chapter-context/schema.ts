import { z } from 'zod';

const text = z.string().trim().max(2000);
const entityKey = z.string().trim().min(1).max(200);
export const chapterContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary: z.string().trim().min(1).max(6000),
    scenes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            title: z.string().max(300),
            environment: z
              .object({ location: text, time: text, weather: text, lighting: text, details: text })
              .strict(),
            entities: z
              .array(
                z
                  .object({
                    entityKey,
                    keywordId: z.string().uuid().nullable(),
                    name: z.string().trim().min(1).max(300),
                    kind: z.enum(['character', 'object', 'location', 'group', 'other']),
                    appearance: text,
                    condition: text,
                    clothing: text,
                    equipment: z.array(z.string().max(300)).max(20),
                    pose: text,
                    emotion: text,
                    relations: z.array(z.string().max(500)).max(20),
                    evidence: z.string().max(500),
                  })
                  .strict(),
              )
              .max(80),
          })
          .strict(),
      )
      .max(30),
    stateChanges: z
      .array(
        z
          .object({
            entityKey,
            sceneId: z.string().min(1).max(80),
            field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/),
            value: z.string().max(2000).nullable(),
            evidence: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(300),
  })
  .strict()
  .superRefine((value, ctx) => {
    const sceneIds = new Set<string>();
    const identities = new Map<string, string | null>();
    for (const scene of value.scenes) {
      if (sceneIds.has(scene.id))
        ctx.addIssue({ code: 'custom', message: 'Scene ids must be unique' });
      sceneIds.add(scene.id);
      const keys = new Set<string>();
      for (const entity of scene.entities) {
        if (keys.has(entity.entityKey))
          ctx.addIssue({ code: 'custom', message: 'Duplicate entity in scene' });
        keys.add(entity.entityKey);
        if (entity.keywordId && entity.entityKey !== `keyword:${entity.keywordId}`)
          ctx.addIssue({ code: 'custom', message: 'Registered entity keys must use keyword:<id>' });
        if (!entity.keywordId && !entity.entityKey.startsWith('name:'))
          ctx.addIssue({
            code: 'custom',
            message: 'Unregistered entity keys must use name:<normalized name>',
          });
        if (
          identities.has(entity.entityKey) &&
          identities.get(entity.entityKey) !== entity.keywordId
        )
          ctx.addIssue({ code: 'custom', message: 'Entity identity must stay consistent' });
        identities.set(entity.entityKey, entity.keywordId);
      }
    }
    const changes = new Set<string>();
    for (const change of value.stateChanges) {
      const scene = value.scenes.find((scene) => scene.id === change.sceneId);
      if (!scene?.entities.some((entity) => entity.entityKey === change.entityKey))
        ctx.addIssue({
          code: 'custom',
          message: 'Changes must reference an entity present in that scene',
        });
      const key = `${change.sceneId}:${change.entityKey}:${change.field}`;
      if (changes.has(key)) ctx.addIssue({ code: 'custom', message: 'Duplicate state change' });
      changes.add(key);
    }
  });
export type ChapterContext = z.infer<typeof chapterContextSchema>;
export type InactiveEntity = {
  entityKey: string;
  name: string;
  keywordId: string | null;
  lastMentionedChapter: number;
  missingChapters: number;
};
export type ChapterContextRecord = {
  context: ChapterContext | null;
  contentHash: string | null;
  generating: boolean;
  inactiveEntities: InactiveEntity[];
};
export type ContinuityContext = {
  chapters: { chapterNumber: number; context: ChapterContext }[];
  lastMentions: {
    entityKey: string;
    name: string;
    chapterNumber: number;
    context: ChapterContext;
  }[];
  persistentState: {
    entityKey: string;
    chapterNumber: number;
    field: string;
    value: { value: string | null; sceneId: string; evidence: string };
  }[];
};
