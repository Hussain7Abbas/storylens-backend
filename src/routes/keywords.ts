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
import {
	assertOwnsResource,
	shouldBeGuest,
	shouldBeUser,
} from "@/middleware/authorize";
import { paginationSchema, sortingSchema } from "@/schemas/common";
import { setup } from "@/setup";
import { HttpError } from "@/utils/errors";
import { getNestedColumnObject, parsePaginationProps } from "@/utils/helpers";
import { sanitizeObject } from "@/utils/sanitize";
import { orderByIds, queryWeightedSearchIds } from "@/utils/weighted-search";

const aliasShape = t.Object({
	...KeywordAliasPlain.properties,
	category: t.Nullable(KeywordCategoryPlain),
	nature: t.Nullable(KeywordNaturePlain),
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

const aliasInclude = { category: true, nature: true } as const;

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
	.use(shouldBeGuest())

	// Get all keywords with filters
	.get(
		"/",
		async ({ prisma, query: { pagination, query, sorting } }) => {
			const { skip, take } = parsePaginationProps(pagination);

			const where: Record<string, unknown> = {};

			if (query?.categoryId) {
				where.versions = { some: { categoryId: query.categoryId } };
			}

			if (query?.natureId) {
				where.versions = { some: { natureId: query.natureId } };
			}

			if (query?.novelId) {
				where.novelId = query.novelId;
			}

			if (query?.search) {
				const { ids, total } = await queryWeightedSearchIds(prisma, {
					table: "Keyword",
					primaryColumn: "name",
					secondaryColumn: "name",
					search: query.search,
					filters: {
						novelId: query.novelId,
					},
					skip: skip ?? 0,
					take: take ?? 25,
					sortColumn: sorting?.column,
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
					orderBy: getNestedColumnObject(sorting?.column, sorting?.direction),
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

	// Create keyword (user + admin)
	.use(shouldBeUser())
	.post(
		"/",
		async ({ t, prisma, body, authedUser }) => {
			const sanitizedBody = sanitizeObject(body);
			const { name, novelId, categoryId, natureId } = sanitizedBody;

			const [category, nature, novel] = await Promise.all([
				prisma.keywordCategory.findUnique({ where: { id: categoryId } }),
				prisma.keywordNature.findUnique({ where: { id: natureId } }),
				prisma.novel.findUnique({ where: { id: novelId } }),
			]);

			if (!category) throw new HttpError({ statusCode: 404, message: t({ en: "Category not found", ar: "الفئة غير موجودة" }) });
			if (!nature) throw new HttpError({ statusCode: 404, message: t({ en: "Nature not found", ar: "الطبيعة غير موجودة" }) });
			if (!novel) throw new HttpError({ statusCode: 404, message: t({ en: "Novel not found", ar: "الرواية غير موجودة" }) });

			const existing = await prisma.keyword.findFirst({ where: { name, novelId } });
			if (existing) {
				throw new HttpError({
					message: t({ en: "Keyword name already exists for this novel", ar: "اسم الكلمة المفتاحية موجود بالفعل لهذه الرواية" }),
				});
			}

			const keyword = await prisma.$transaction(async (tx) => {
				const kw = await tx.keyword.create({
					data: {
						name,
						matchingType: sanitizedBody.matchingType ?? "FULL",
						novelId,
						createdById: authedUser.id,
					},
				});

				await tx.keywordVersion.create({
					data: {
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
			});

			return keyword as unknown as KeywordWithChildren;
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1 }),
				description: t.Optional(t.String()),
				matchingType: t.Optional(MatchingType),
				novelId: t.String({ format: "uuid" }),
				categoryId: t.String({ format: "uuid" }),
				natureId: t.String({ format: "uuid" }),
				imageId: t.Optional(t.String({ format: "uuid" })),
			}),
			response: {
				200: keywordWithChildrenShape,
			},
		},
	)

	// Update keyword (own only for user, all for admin)
	.put(
		"/:id",
		async ({ t, prisma, params: { id }, body, authedUser }) => {
			const existingKeyword = await prisma.keyword.findUnique({ where: { id } });

			if (!existingKeyword) {
				throw new HttpError({
					statusCode: 404,
					message: t({ en: "Keyword not found", ar: "الكلمة المفتاحية غير موجودة" }),
				});
			}

			assertOwnsResource(existingKeyword.createdById, authedUser);

			const sanitizedBody = sanitizeObject(body);

			if (sanitizedBody.name && sanitizedBody.name !== existingKeyword.name) {
				const conflict = await prisma.keyword.findFirst({
					where: { name: sanitizedBody.name, novelId: existingKeyword.novelId, id: { not: id } },
				});
				if (conflict) {
					throw new HttpError({
						message: t({ en: "Keyword name already exists for this novel", ar: "اسم الكلمة المفتاحية موجود بالفعل لهذه الرواية" }),
					});
				}
			}

			const keyword = await prisma.keyword.update({
				where: { id },
				data: {
					name: sanitizedBody.name,
					matchingType: sanitizedBody.matchingType,
				},
				include: keywordInclude,
			});

			return keyword as unknown as KeywordWithChildren;
		},
		{
			params: t.Object({
				id: t.String({ format: "uuid" }),
			}),
			body: t.Object({
				name: t.Optional(t.String({ minLength: 1 })),
				matchingType: t.Optional(MatchingType),
			}),
			response: {
				200: keywordWithChildrenShape,
			},
		},
	)

	// Delete keyword (own only for user, all for admin)
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
