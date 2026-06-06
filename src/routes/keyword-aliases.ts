import { Elysia, t } from "elysia";
import { KeywordAliasPlain, KeywordCategoryPlain, KeywordNaturePlain, MatchingType } from "@/lib/db";
import { assertOwnsResource, shouldBeGuest, shouldBeUser } from "@/middleware/authorize";
import { paginationSchema, sortingSchema } from "@/schemas/common";
import { setup } from "@/setup";
import { HttpError } from "@/utils/errors";
import { getNestedColumnObject, parsePaginationProps } from "@/utils/helpers";
import { sanitizeObject } from "@/utils/sanitize";

const aliasInclude = { category: true, nature: true } as const;

const aliasWithStyleShape = t.Object({
	...KeywordAliasPlain.properties,
	category: t.Nullable(KeywordCategoryPlain),
	nature: t.Nullable(KeywordNaturePlain),
});

export const keywordAliases = new Elysia({ prefix: "/keyword-aliases", tags: ["Keywords"] })
	.use(setup)
	.use(shouldBeGuest())

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

	.use(shouldBeUser())

	.post(
		"/",
		async ({ t, prisma, body, authedUser }) => {
			const sanitizedBody = sanitizeObject(body);
			const { keywordId, name } = sanitizedBody;

			const keyword = await prisma.keyword.findUnique({ where: { id: keywordId } });
			if (!keyword) {
				throw new HttpError({ statusCode: 404, message: t({ en: "Keyword not found", ar: "الكلمة المفتاحية غير موجودة" }) });
			}

			const existing = await prisma.keywordAlias.findFirst({ where: { keywordId, name } });
			if (existing) {
				throw new HttpError({
					message: t({ en: "Alias name already exists for this keyword", ar: "اسم الاسم المستعار موجود بالفعل لهذه الكلمة المفتاحية" }),
				});
			}

			const alias = await prisma.keywordAlias.create({
				data: {
					name,
					description: sanitizedBody.description ?? null,
					matchingType: sanitizedBody.matchingType ?? "FULL",
					categoryId: sanitizedBody.categoryId ?? null,
					natureId: sanitizedBody.natureId ?? null,
					overrideStyle: sanitizedBody.overrideStyle ?? false,
					keywordId,
					createdById: authedUser.id,
				},
				include: aliasInclude,
			});

			return alias;
		},
		{
			body: t.Object({
				keywordId: t.String({ format: "uuid" }),
				name: t.String({ minLength: 1 }),
				description: t.Optional(t.String()),
				matchingType: t.Optional(MatchingType),
				categoryId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				natureId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				overrideStyle: t.Optional(t.Boolean()),
			}),
			response: { 200: aliasWithStyleShape },
		},
	)

	.put(
		"/:id",
		async ({ t, prisma, params: { id }, body, authedUser }) => {
			const existing = await prisma.keywordAlias.findUnique({
				where: { id },
				include: { keyword: true },
			});

			if (!existing) {
				throw new HttpError({ statusCode: 404, message: t({ en: "Alias not found", ar: "الاسم المستعار غير موجود" }) });
			}

			assertOwnsResource(existing.keyword.createdById, authedUser);

			const sanitizedBody = sanitizeObject(body);

			if (sanitizedBody.name && sanitizedBody.name !== existing.name) {
				const conflict = await prisma.keywordAlias.findFirst({
					where: { keywordId: existing.keywordId, name: sanitizedBody.name, id: { not: id } },
				});
				if (conflict) {
					throw new HttpError({
						message: t({ en: "Alias name already exists for this keyword", ar: "اسم الاسم المستعار موجود بالفعل لهذه الكلمة المفتاحية" }),
					});
				}
			}

			const alias = await prisma.keywordAlias.update({
				where: { id },
				data: {
					name: sanitizedBody.name,
					description: sanitizedBody.description,
					matchingType: sanitizedBody.matchingType,
					categoryId: sanitizedBody.categoryId,
					natureId: sanitizedBody.natureId,
					overrideStyle: sanitizedBody.overrideStyle,
				},
				include: aliasInclude,
			});

			return alias;
		},
		{
			params: t.Object({ id: t.String({ format: "uuid" }) }),
			body: t.Object({
				name: t.Optional(t.String({ minLength: 1 })),
				description: t.Optional(t.String()),
				matchingType: t.Optional(MatchingType),
				categoryId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				natureId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				overrideStyle: t.Optional(t.Boolean()),
			}),
			response: { 200: aliasWithStyleShape },
		},
	)

	.delete(
		"/:id",
		async ({ t, prisma, params: { id }, authedUser }) => {
			const existing = await prisma.keywordAlias.findUnique({
				where: { id },
				include: { keyword: true },
			});

			if (!existing) {
				throw new HttpError({ statusCode: 404, message: t({ en: "Alias not found", ar: "الاسم المستعار غير موجود" }) });
			}

			assertOwnsResource(existing.keyword.createdById, authedUser);

			await prisma.keywordAlias.delete({ where: { id } });

			return existing;
		},
		{
			params: t.Object({ id: t.String({ format: "uuid" }) }),
			response: { 200: KeywordAliasPlain },
		},
	);

// Re-export for use in keywords.ts response shape
export { aliasWithStyleShape };
