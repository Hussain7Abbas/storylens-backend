import { Elysia, t, type Static } from "elysia";
import {
	ChapterPlain,
	FilePlain,
	KeywordAliasPlain,
	KeywordCategoryPlain,
	KeywordNaturePlain,
	KeywordPlain,
	KeywordVersionPlain,
	KeywordsChaptersPlain,
	MatchingType,
	NovelPlain,
	ReplacementPlain,
} from "@/lib/db";
import type { PrismaClient } from "@prisma/client";
import { assertNotStale, compareAndSwap } from "@/lib/sync/precondition";
import { createWithReplay, findReplay } from "@/lib/sync/replay";
import { assertOwnsResource, authorize } from "@/middleware/authorize";
import { paginationSchema, sortingSchema, staleWriteSchema } from "@/schemas/common";
import { setup } from "@/setup";
import { cleanKeywordName, stripArabicDiacritics } from "@/utils/arabic";
import { HttpError } from "@/utils/errors";
import { getNestedColumnObject, parsePaginationProps } from "@/utils/helpers";
import { sanitizeObject } from "@/utils/sanitize";
import {
	assertHasName,
	type Language,
	nameField,
	translatedNameBody,
} from "@/utils/translation";
import { orderByIds, queryWeightedSearchIds } from "@/utils/weighted-search";

/** A `name` sort column reads the request language's field. */
function localizedSortColumn(column: string | undefined, lang: Language): string | undefined {
	return column === "name" ? nameField(lang) : column;
}

function parentNotFound(message: string): HttpError {
	return new HttpError({ statusCode: 404, code: "PARENT_NOT_FOUND", message });
}

/** Keyword names are unique per novel in each language; `exceptId` is the row being saved. */
async function assertKeywordNamesFree(
	prisma: PrismaClient,
	t: (messages: { en: string; ar: string }) => string,
	novelId: string,
	names: ({ nameAr: string } | { nameEn: string })[],
	exceptId: string,
): Promise<void> {
	if (!names.length) return;
	const conflict = await prisma.keyword.findFirst({
		where: { novelId, id: { not: exceptId }, OR: names },
	});
	if (conflict) {
		throw new HttpError({
			statusCode: 409,
			code: "KEYWORD_NAME_TAKEN",
			message: t({ en: "Keyword name already exists for this novel", ar: "اسم الكلمة المفتاحية موجود بالفعل لهذه الرواية" }),
		});
	}
}

function cleanName(value: string | null | undefined): string | null | undefined {
	return value === undefined || value === null ? value : cleanKeywordName(sanitizeObject(value));
}

const aliasShape = t.Object({
	...KeywordAliasPlain.properties,
	category: t.Nullable(KeywordCategoryPlain),
	nature: t.Nullable(KeywordNaturePlain),
	image: t.Nullable(FilePlain),
});

const versionShape = t.Object({
	...KeywordVersionPlain.properties,
	category: t.Nullable(KeywordCategoryPlain),
	nature: t.Nullable(KeywordNaturePlain),
	image: t.Nullable(FilePlain),
});

const keywordWithChildrenShape = t.Object({
	...KeywordPlain.properties,
	aliases: t.Array(aliasShape),
	versions: t.Array(versionShape),
});

type KeywordWithChildren = Static<typeof keywordWithChildrenShape>;

const versionInclude = {
	category: true,
	nature: true,
	image: true,
} as const;

const aliasInclude = { category: true, nature: true, image: true } as const;

const keywordInclude = {
	aliases: {
		include: aliasInclude,
		orderBy: { createdAt: "asc" as const },
	},
	versions: {
		include: versionInclude,
		orderBy: { startingChapter: "asc" as const },
	},
} as const;

export const keywords = new Elysia({ prefix: "/keywords", tags: ["Keywords"] })
	.use(setup)
	.use(authorize('user'))

	// Get all keywords with filters
	.get(
		"/",
		async ({ prisma, lang, query: { pagination, query, sorting } }) => {
			const { skip, take } = parsePaginationProps(pagination);
			const name = nameField(lang);
			const sortColumn = localizedSortColumn(sorting?.column, lang);

			// Readers only see keywords named in their language.
			const where: Record<string, unknown> = { [name]: { not: null } };

			if (query?.categoryId) {
				where.versions = { some: { categoryId: query.categoryId } };
			}

			if (query?.natureId) {
				where.versions = { some: { natureId: query.natureId } };
			}

			if (query?.novelId) {
				where.novelId = query.novelId;
			}

			// Names are stored without Arabic diacritics, so the search drops them too.
			const search = query?.search ? stripArabicDiacritics(query.search) : "";
			if (search) {
				const { ids, total } = await queryWeightedSearchIds(prisma, {
					table: "Keyword",
					primaryColumn: name,
					secondaryColumn: name,
					search,
					filters: {
						novelId: query?.novelId,
						notNullColumn: name,
					},
					skip: skip ?? 0,
					take: take ?? 25,
					sortColumn,
					sortDirection: sorting?.direction,
				});

				if (ids.length === 0) {
					return { data: [], total };
				}

				const kws = await prisma.keyword.findMany({
					where: { id: { in: ids } },
					include: keywordInclude,
				});

				return {
					data: orderByIds(kws, ids) as unknown as KeywordWithChildren[],
					total,
				};
			}

			const [kws, total] = await Promise.all([
				prisma.keyword.findMany({
					where,
					skip,
					take,
					include: keywordInclude,
					orderBy: getNestedColumnObject(sortColumn, sorting?.direction),
				}),
				prisma.keyword.count({ where }),
			]);

			return { data: kws as unknown as KeywordWithChildren[], total };
		},
		{
			query: t.Object({
				pagination: paginationSchema,
				sorting: sortingSchema,
				query: t.Optional(
					t.Object({
						search: t.Optional(t.String()),
						categoryId: t.Optional(t.String({ format: "uuid" })),
						natureId: t.Optional(t.String({ format: "uuid" })),
						novelId: t.Optional(t.String({ format: "uuid" })),
					}),
				),
			}),
			response: {
				200: t.Object({
					data: t.Array(keywordWithChildrenShape),
					total: t.Number(),
				}),
			},
		},
	)

	// Get keyword by ID
	.get(
		"/:id",
		async ({ t, prisma, params: { id } }) => {
			const keyword = await prisma.keyword.findUnique({
				where: { id },
				include: {
					...keywordInclude,
					novel: true,
					KeywordsChapters: { include: { chapter: true } },
					replacements: true,
				},
			});

			if (!keyword) {
				throw new HttpError({
					statusCode: 404,
					code: "NOT_FOUND",
					message: t({
						en: "Keyword not found",
						ar: "الكلمة المفتاحية غير موجودة",
					}),
				});
			}

			return keyword;
		},
		{
			params: t.Object({
				id: t.String({ format: "uuid" }),
			}),
			response: {
				200: t.Composite([
					keywordWithChildrenShape,
					t.Object({
						novel: t.Nullable(NovelPlain),
						KeywordsChapters: t.Array(
							t.Composite([
								KeywordsChaptersPlain,
								t.Object({ chapter: ChapterPlain }),
							]),
						),
						replacements: t.Array(ReplacementPlain),
					}),
				]),
			},
		},
	)

	// Create keyword (reader and moderator). The client sends the IDs of the keyword and
	// its base version, so a replay (a lost response sent again) returns the same row.
	.post(
		"/",
		async ({ t, prisma, body, authedUser }) => {
			const findKeyword = () =>
				prisma.keyword.findUnique({ where: { id: body.id }, include: keywordInclude });
			const isReplay = (row: { createdById: string | null; novelId: string }) =>
				row.createdById === authedUser.id && row.novelId === body.novelId;

			const replay = await findReplay(findKeyword, isReplay, t);
			if (replay) return replay as unknown as KeywordWithChildren;

			const sanitizedBody = sanitizeObject(body);
			const { novelId, categoryId, natureId } = sanitizedBody;
			const names = { nameAr: cleanName(body.nameAr), nameEn: cleanName(body.nameEn) };
			assertHasName(names, t);

			const [category, nature, novel] = await Promise.all([
				prisma.keywordCategory.findUnique({ where: { id: categoryId } }),
				prisma.keywordNature.findUnique({ where: { id: natureId } }),
				prisma.novel.findUnique({ where: { id: novelId } }),
			]);

			if (!category) throw parentNotFound(t({ en: "Category not found", ar: "الفئة غير موجودة" }));
			if (!nature) throw parentNotFound(t({ en: "Nature not found", ar: "الطبيعة غير موجودة" }));
			if (!novel) throw parentNotFound(t({ en: "Novel not found", ar: "الرواية غير موجودة" }));

			await assertKeywordNamesFree(prisma, t, novelId, [
				...(names.nameAr ? [{ nameAr: names.nameAr }] : []),
				...(names.nameEn ? [{ nameEn: names.nameEn }] : []),
			], body.id);

			const keyword = await createWithReplay(
				() =>
					prisma.$transaction(async (tx) => {
						const kw = await tx.keyword.create({
							data: {
								id: body.id,
								...names,
								matchingType: sanitizedBody.matchingType ?? "FULL",
								fuzzyMatchArabicCharacters: sanitizedBody.fuzzyMatchArabicCharacters ?? true,
								novelId,
								createdById: authedUser.id,
							},
						});

						await tx.keywordVersion.create({
							data: {
								id: body.versionId,
								description: sanitizedBody.description ?? null,
								categoryId,
								natureId,
								imageId: sanitizedBody.imageId ?? null,
								keywordId: kw.id,
								startingChapter: 0,
								endingChapter: null,
								createdById: authedUser.id,
							},
						});

						return tx.keyword.findUniqueOrThrow({
							where: { id: kw.id },
							include: keywordInclude,
						});
					}),
				findKeyword,
				isReplay,
				t,
			);

			return keyword as unknown as KeywordWithChildren;
		},
		{
			body: t.Object({
				id: t.String({ format: "uuid" }),
				versionId: t.String({ format: "uuid" }),
				...translatedNameBody,
				description: t.Optional(t.Nullable(t.String())),
				matchingType: t.Optional(MatchingType),
				fuzzyMatchArabicCharacters: t.Optional(t.Boolean()),
				novelId: t.String({ format: "uuid" }),
				categoryId: t.String({ format: "uuid" }),
				natureId: t.String({ format: "uuid" }),
				imageId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
			}),
			response: {
				200: keywordWithChildrenShape,
			},
		},
	)

	// Update keyword (own for readers, any for moderators). Partial: only sent fields change.
	.put(
		"/:id",
		async ({ t, prisma, params: { id }, body, authedUser }) => {
			const existingKeyword = await prisma.keyword.findUnique({ where: { id } });

			if (!existingKeyword) {
				throw new HttpError({
					statusCode: 404,
					code: "NOT_FOUND",
					message: t({ en: "Keyword not found", ar: "الكلمة المفتاحية غير موجودة" }),
				});
			}

			assertOwnsResource(existingKeyword.createdById, authedUser);
			await assertNotStale(
				existingKeyword,
				body.baseUpdatedAt,
				() => prisma.keyword.findUniqueOrThrow({ where: { id }, include: keywordInclude }),
				t,
			);

			const sanitizedBody = sanitizeObject(body);
			const names = { nameAr: cleanName(body.nameAr), nameEn: cleanName(body.nameEn) };
			assertHasName(
				{
					nameAr: names.nameAr === undefined ? existingKeyword.nameAr : names.nameAr,
					nameEn: names.nameEn === undefined ? existingKeyword.nameEn : names.nameEn,
				},
				t,
			);

			await assertKeywordNamesFree(prisma, t, existingKeyword.novelId, [
				...(names.nameAr && names.nameAr !== existingKeyword.nameAr ? [{ nameAr: names.nameAr }] : []),
				...(names.nameEn && names.nameEn !== existingKeyword.nameEn ? [{ nameEn: names.nameEn }] : []),
			], id);

			const keyword = await compareAndSwap(() => prisma.keyword.update({
				where: { id, updatedAt: existingKeyword.updatedAt },
				data: {
					...names,
					matchingType: sanitizedBody.matchingType,
					fuzzyMatchArabicCharacters: sanitizedBody.fuzzyMatchArabicCharacters,
				},
				include: keywordInclude,
			}), () => prisma.keyword.findUniqueOrThrow({ where: { id }, include: keywordInclude }), t);

			return keyword as unknown as KeywordWithChildren;
		},
		{
			params: t.Object({
				id: t.String({ format: "uuid" }),
			}),
			body: t.Object({
				baseUpdatedAt: t.String({ format: "date-time" }),
				...translatedNameBody,
				matchingType: t.Optional(MatchingType),
				fuzzyMatchArabicCharacters: t.Optional(t.Boolean()),
			}),
			response: {
				200: keywordWithChildrenShape,
				409: staleWriteSchema(keywordWithChildrenShape),
			},
		},
	)

	// Delete keyword (own for readers, any for moderators)
	.delete(
		"/:id",
		async ({ t, prisma, params: { id }, authedUser }) => {
			const existingKeyword = await prisma.keyword.findUnique({
				where: { id },
				include: {
					_count: {
						select: {
							aliases: true,
							versions: true,
							KeywordsChapters: true,
							replacements: true,
						},
					},
				},
			});

			if (!existingKeyword) {
				throw new HttpError({
					statusCode: 404,
					code: "NOT_FOUND",
					message: t({ en: "Keyword not found", ar: "الكلمة المفتاحية غير موجودة" }),
				});
			}

			assertOwnsResource(existingKeyword.createdById, authedUser);

			await prisma.$transaction([
				prisma.keywordsChapters.deleteMany({ where: { keywordId: id } }),
				prisma.keyword.delete({ where: { id } }),
			]);

			return existingKeyword;
		},
		{
			params: t.Object({
				id: t.String({ format: "uuid" }),
			}),
			response: {
				200: KeywordPlain,
			},
		},
	);
