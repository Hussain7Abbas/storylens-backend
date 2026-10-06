import type { PrismaClient } from "@prisma/client";
import { Elysia, t } from "elysia";
import { FilePlain, KeywordAliasPlain, KeywordCategoryPlain, KeywordNaturePlain, MatchingType } from "@/lib/db";
import { mergeTranslationAlias } from "@/lib/keywords/merge";
import { assertNotStale, compareAndSwap } from "@/lib/sync/precondition";
import { createWithReplay, findReplay } from "@/lib/sync/replay";
import { assertOwnsAnyOf, authorize } from "@/middleware/authorize";
import { paginationSchema, sortingSchema, staleWriteSchema } from "@/schemas/common";
import { setup } from "@/setup";
import { cleanKeywordName } from "@/utils/arabic";
import { HttpError } from "@/utils/errors";
import { getNestedColumnObject, parsePaginationProps } from "@/utils/helpers";
import { sanitizeObject } from "@/utils/sanitize";
import { assertHasName, translatedNameBody } from "@/utils/translation";

const aliasInclude = { category: true, nature: true, image: true } as const;

const aliasWithStyleShape = t.Object({
	...KeywordAliasPlain.properties,
	category: t.Nullable(KeywordCategoryPlain),
	nature: t.Nullable(KeywordNaturePlain),
	image: t.Nullable(FilePlain),
});

type Translate = (messages: { en: string; ar: string }) => string;

function cleanName(value: string | null | undefined): string | null | undefined {
	return value === undefined || value === null ? value : cleanKeywordName(value);
}

function aliasNotFound(t: Translate): HttpError {
	return new HttpError({ statusCode: 404, code: "NOT_FOUND", message: t({ en: "Alias not found", ar: "الاسم المستعار غير موجود" }) });
}

/** Alias names are unique per keyword in each language; `exceptId` is the row being saved. */
async function assertAliasNamesFree(
	prisma: PrismaClient,
	t: Translate,
	keywordId: string,
	names: ({ nameAr: string } | { nameEn: string })[],
	exceptId: string,
): Promise<void> {
	if (!names.length) return;
	const conflict = await prisma.keywordAlias.findFirst({ where: { keywordId, id: { not: exceptId }, OR: names } });
	if (conflict) {
		throw new HttpError({
			statusCode: 409,
			code: "ALIAS_NAME_TAKEN",
			message: t({ en: "Alias name already exists for this keyword", ar: "اسم الاسم المستعار موجود بالفعل لهذه الكلمة المفتاحية" }),
		});
	}
}

export const keywordAliases = new Elysia({ prefix: "/keyword-aliases", tags: ["Keywords"] })
	.use(setup)
	.use(authorize('user'))

	.get(
		"/",
		async ({ prisma, query: { pagination, sorting, query } }) => {
			const { skip, take } = parsePaginationProps(pagination);

			const where: Record<string, unknown> = {};
			if (query?.keywordId) where.keywordId = query.keywordId;

			const [aliases, total] = await Promise.all([
				prisma.keywordAlias.findMany({
					where,
					include: aliasInclude,
					skip,
					take,
					orderBy: getNestedColumnObject(sorting?.column, sorting?.direction),
				}),
				prisma.keywordAlias.count({ where }),
			]);

			return { data: aliases, total };
		},
		{
			query: t.Object({
				pagination: paginationSchema,
				sorting: sortingSchema,
				query: t.Optional(
					t.Object({
						keywordId: t.Optional(t.String({ format: "uuid" })),
					}),
				),
			}),
			response: {
				200: t.Object({
					data: t.Array(aliasWithStyleShape),
					total: t.Number(),
				}),
			},
		},
	)

	// Any reader may add an alias to any keyword. The client sends the alias ID, so a
	// replay (a lost response sent again) returns the same row.
	.post(
		"/",
		async ({ t, prisma, body, authedUser }) => {
			const findAlias = () => prisma.keywordAlias.findUnique({ where: { id: body.id }, include: aliasInclude });
			const isReplay = (row: { createdById: string | null; keywordId: string }) =>
				row.createdById === authedUser.id && row.keywordId === body.keywordId;

			const replay = await findReplay(findAlias, isReplay, t);
			if (replay) return replay;

			const sanitizedBody = sanitizeObject(body);
			const { keywordId } = sanitizedBody;
			const names = { nameAr: cleanName(body.nameAr) ?? null, nameEn: cleanName(body.nameEn) ?? null };
			assertHasName(names, t);

			const keyword = await prisma.keyword.findUnique({ where: { id: keywordId } });
			if (!keyword) {
				throw new HttpError({ statusCode: 404, code: "PARENT_NOT_FOUND", message: t({ en: "Keyword not found", ar: "الكلمة المفتاحية غير موجودة" }) });
			}

			await assertAliasNamesFree(prisma, t, keywordId, [
				...(names.nameAr ? [{ nameAr: names.nameAr }] : []),
				...(names.nameEn ? [{ nameEn: names.nameEn }] : []),
			], body.id);

			return createWithReplay(
				() =>
					prisma.$transaction(async (tx) => {
						// A translation link merges the sibling alias named in the other
						// language into this one, freeing its name before the create.
						const linked = body.translationAliasId
							? await mergeTranslationAlias(tx, {
									target: { id: body.id, keywordId, ...names },
									sourceId: body.translationAliasId,
									t,
									assertMayAbsorb: (source) =>
										assertOwnsAnyOf([source.createdById, keyword.createdById], authedUser),
								})
							: {};
						return tx.keywordAlias.create({
							data: {
								id: body.id,
								...names,
								...linked,
								description: sanitizedBody.description ?? null,
								matchingType: sanitizedBody.matchingType ?? "FULL",
								fuzzyMatchArabicCharacters: sanitizedBody.fuzzyMatchArabicCharacters ?? true,
								categoryId: sanitizedBody.categoryId ?? null,
								natureId: sanitizedBody.natureId ?? null,
								imageId: sanitizedBody.imageId ?? null,
								overrideStyle: sanitizedBody.overrideStyle ?? false,
								keywordId,
								createdById: authedUser.id,
							},
							include: aliasInclude,
						});
					}),
				findAlias,
				isReplay,
				t,
			);
		},
		{
			body: t.Object({
				id: t.String({ format: "uuid" }),
				keywordId: t.String({ format: "uuid" }),
				...translatedNameBody,
				description: t.Optional(t.Nullable(t.String())),
				matchingType: t.Optional(MatchingType),
				fuzzyMatchArabicCharacters: t.Optional(t.Boolean()),
				categoryId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				natureId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				imageId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				overrideStyle: t.Optional(t.Boolean()),
				// Translation link: the alias of the same keyword that holds this one's
				// other-language name. It is merged into the new alias and deleted.
				translationAliasId: t.Optional(t.String({ format: "uuid" })),
			}),
			response: { 200: aliasWithStyleShape },
		},
	)

	// A moderator, the alias's own creator or the parent keyword's creator may edit it.
	// Partial: only sent fields change; `null` clears the description or image.
	.put(
		"/:id",
		async ({ t, prisma, params: { id }, body, authedUser }) => {
			const existing = await prisma.keywordAlias.findUnique({
				where: { id },
				include: { keyword: true },
			});

			if (!existing) throw aliasNotFound(t);

			assertOwnsAnyOf([existing.createdById, existing.keyword.createdById], authedUser);
			await assertNotStale(
				existing,
				body.baseUpdatedAt,
				() => prisma.keywordAlias.findUniqueOrThrow({ where: { id }, include: aliasInclude }),
				t,
			);

			const sanitizedBody = sanitizeObject(body);
			const names = { nameAr: cleanName(body.nameAr), nameEn: cleanName(body.nameEn) };
			assertHasName(
				{
					nameAr: names.nameAr === undefined ? existing.nameAr : names.nameAr,
					nameEn: names.nameEn === undefined ? existing.nameEn : names.nameEn,
				},
				t,
			);

			await assertAliasNamesFree(prisma, t, existing.keywordId, [
				...(names.nameAr && names.nameAr !== existing.nameAr ? [{ nameAr: names.nameAr }] : []),
				...(names.nameEn && names.nameEn !== existing.nameEn ? [{ nameEn: names.nameEn }] : []),
			], id);

			return compareAndSwap(
				() =>
					prisma.$transaction(async (tx) => {
						const linked = body.translationAliasId
							? await mergeTranslationAlias(tx, {
									target: {
										id,
										keywordId: existing.keywordId,
										nameAr: names.nameAr === undefined ? existing.nameAr : names.nameAr,
										nameEn: names.nameEn === undefined ? existing.nameEn : names.nameEn,
									},
									sourceId: body.translationAliasId,
									t,
									assertMayAbsorb: (source) =>
										assertOwnsAnyOf([source.createdById, existing.keyword.createdById], authedUser),
								})
							: {};
						return tx.keywordAlias.update({
							where: { id, updatedAt: existing.updatedAt },
							data: {
								...names,
								...linked,
								description: sanitizedBody.description,
								matchingType: sanitizedBody.matchingType,
								fuzzyMatchArabicCharacters: sanitizedBody.fuzzyMatchArabicCharacters,
								categoryId: sanitizedBody.categoryId,
								natureId: sanitizedBody.natureId,
								imageId: sanitizedBody.imageId,
								overrideStyle: sanitizedBody.overrideStyle,
							},
							include: aliasInclude,
						});
					}),
				() => prisma.keywordAlias.findUniqueOrThrow({ where: { id }, include: aliasInclude }),
				t,
			);
		},
		{
			params: t.Object({ id: t.String({ format: "uuid" }) }),
			body: t.Object({
				baseUpdatedAt: t.String({ format: "date-time" }),
				...translatedNameBody,
				description: t.Optional(t.Nullable(t.String())),
				matchingType: t.Optional(MatchingType),
				fuzzyMatchArabicCharacters: t.Optional(t.Boolean()),
				categoryId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				natureId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				imageId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				overrideStyle: t.Optional(t.Boolean()),
				// Translation link: the alias of the same keyword that holds this one's
				// other-language name. It is merged into this alias and deleted.
				translationAliasId: t.Optional(t.String({ format: "uuid" })),
			}),
			response: { 200: aliasWithStyleShape, 409: staleWriteSchema(aliasWithStyleShape) },
		},
	)

	// Deletes are unconditional (a delete wins over a remote edit).
	.delete(
		"/:id",
		async ({ t, prisma, params: { id }, authedUser }) => {
			const existing = await prisma.keywordAlias.findUnique({
				where: { id },
				include: { keyword: true },
			});

			if (!existing) throw aliasNotFound(t);

			assertOwnsAnyOf([existing.createdById, existing.keyword.createdById], authedUser);

			await prisma.keywordAlias.delete({ where: { id } });

			const { keyword: _keyword, ...alias } = existing;
			return alias;
		},
		{
			params: t.Object({ id: t.String({ format: "uuid" }) }),
			response: { 200: KeywordAliasPlain },
		},
	);

// Re-export for use in keywords.ts response shape
export { aliasWithStyleShape };
