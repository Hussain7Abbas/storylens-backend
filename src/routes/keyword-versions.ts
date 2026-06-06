import { Elysia, t } from "elysia";
import { FilePlain, KeywordCategoryPlain, KeywordNaturePlain, KeywordVersionPlain } from "@/lib/db";
import { assertOwnsResource, isAdmin, shouldBeGuest, shouldBeUser } from "@/middleware/authorize";
import { paginationSchema, sortingSchema } from "@/schemas/common";
import { setup } from "@/setup";
import { HttpError } from "@/utils/errors";
import { getNestedColumnObject, parsePaginationProps } from "@/utils/helpers";
import { sanitizeObject } from "@/utils/sanitize";

const versionWithRelationsShape = t.Object({
	...KeywordVersionPlain.properties,
	category: KeywordCategoryPlain,
	nature: KeywordNaturePlain,
	image: t.Nullable(FilePlain),
});

const versionInclude = {
	category: true,
	nature: true,
	image: true,
} as const;

export const keywordVersions = new Elysia({ prefix: "/keyword-versions", tags: ["Keywords"] })
	.use(setup)
	.use(shouldBeGuest())

	.get(
		"/",
		async ({ prisma, query: { pagination, sorting, query } }) => {
			const { skip, take } = parsePaginationProps(pagination);

			const where: Record<string, unknown> = {};
			if (query?.keywordId) where.keywordId = query.keywordId;

			const [versions, total] = await Promise.all([
				prisma.keywordVersion.findMany({
					where,
					skip,
					take,
					include: versionInclude,
					orderBy: getNestedColumnObject(sorting?.column, sorting?.direction),
				}),
				prisma.keywordVersion.count({ where }),
			]);

			return { data: versions, total };
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
					data: t.Array(versionWithRelationsShape),
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
			const { keywordId, categoryId, natureId } = sanitizedBody;

			const [keyword, category, nature] = await Promise.all([
				prisma.keyword.findUnique({ where: { id: keywordId } }),
				prisma.keywordCategory.findUnique({ where: { id: categoryId } }),
				prisma.keywordNature.findUnique({ where: { id: natureId } }),
			]);

			if (!keyword) throw new HttpError({ statusCode: 404, message: t({ en: "Keyword not found", ar: "الكلمة المفتاحية غير موجودة" }) });
			if (!category) throw new HttpError({ statusCode: 404, message: t({ en: "Category not found", ar: "الفئة غير موجودة" }) });
			if (!nature) throw new HttpError({ statusCode: 404, message: t({ en: "Nature not found", ar: "الطبيعة غير موجودة" }) });

			const latestVersion = await prisma.keywordVersion.findFirst({
				where: { keywordId, endingChapter: null },
				orderBy: { startingChapter: "desc" },
			});

			let startingChapter: number;
			let endingChapter: number | null = null;

			if (isAdmin(authedUser)) {
				startingChapter = sanitizedBody.startingChapter ?? sanitizedBody.currentChapter ?? 0;
				endingChapter = sanitizedBody.endingChapter ?? null;
			} else {
				if (sanitizedBody.currentChapter == null) {
					throw new HttpError({
						statusCode: 400,
						message: t({ en: "currentChapter is required to add a version", ar: "currentChapter مطلوب لإضافة نسخة" }),
					});
				}
				startingChapter = sanitizedBody.currentChapter;
			}

			if (latestVersion && startingChapter <= latestVersion.startingChapter) {
				throw new HttpError({
					statusCode: 400,
					message: t({ en: "startingChapter must be greater than the current latest version", ar: "يجب أن يكون startingChapter أكبر من النسخة الأخيرة الحالية" }),
				});
			}

			const version = await prisma.$transaction(async (tx) => {
				if (latestVersion) {
					await tx.keywordVersion.update({
						where: { id: latestVersion.id },
						data: { endingChapter: startingChapter - 1 },
					});
				}

				return tx.keywordVersion.create({
					data: {
						description: sanitizedBody.description ?? null,
						categoryId,
						natureId,
						imageId: sanitizedBody.imageId ?? null,
						keywordId,
						startingChapter,
						endingChapter,
						createdById: authedUser.id,
					},
					include: versionInclude,
				});
			});

			return version;
		},
		{
			body: t.Object({
				keywordId: t.String({ format: "uuid" }),
				categoryId: t.String({ format: "uuid" }),
				natureId: t.String({ format: "uuid" }),
				description: t.Optional(t.String()),
				imageId: t.Optional(t.String({ format: "uuid" })),
				currentChapter: t.Optional(t.Number({ minimum: 0 })),
				startingChapter: t.Optional(t.Number({ minimum: 0 })),
				endingChapter: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
			}),
			response: { 200: versionWithRelationsShape },
		},
	)

	.put(
		"/:id",
		async ({ t, prisma, params: { id }, body, authedUser }) => {
			const existing = await prisma.keywordVersion.findUnique({
				where: { id },
				include: { keyword: true },
			});

			if (!existing) {
				throw new HttpError({ statusCode: 404, message: t({ en: "Version not found", ar: "النسخة غير موجودة" }) });
			}

			assertOwnsResource(existing.keyword.createdById, authedUser);

			const sanitizedBody = sanitizeObject(body);

			if (sanitizedBody.categoryId || sanitizedBody.natureId) {
				const [category, nature] = await Promise.all([
					sanitizedBody.categoryId
						? prisma.keywordCategory.findUnique({ where: { id: sanitizedBody.categoryId } })
						: Promise.resolve(null),
					sanitizedBody.natureId
						? prisma.keywordNature.findUnique({ where: { id: sanitizedBody.natureId } })
						: Promise.resolve(null),
				]);
				if (sanitizedBody.categoryId && !category) throw new HttpError({ statusCode: 404, message: t({ en: "Category not found", ar: "الفئة غير موجودة" }) });
				if (sanitizedBody.natureId && !nature) throw new HttpError({ statusCode: 404, message: t({ en: "Nature not found", ar: "الطبيعة غير موجودة" }) });
			}

			const updateData: Record<string, unknown> = {
				description: sanitizedBody.description,
				categoryId: sanitizedBody.categoryId,
				natureId: sanitizedBody.natureId,
				imageId: sanitizedBody.imageId,
			};

			if (isAdmin(authedUser)) {
				if (sanitizedBody.startingChapter !== undefined) updateData.startingChapter = sanitizedBody.startingChapter;
				if (sanitizedBody.endingChapter !== undefined) updateData.endingChapter = sanitizedBody.endingChapter;
			}

			const version = await prisma.keywordVersion.update({
				where: { id },
				data: updateData,
				include: versionInclude,
			});

			return version;
		},
		{
			params: t.Object({ id: t.String({ format: "uuid" }) }),
			body: t.Object({
				description: t.Optional(t.String()),
				categoryId: t.Optional(t.String({ format: "uuid" })),
				natureId: t.Optional(t.String({ format: "uuid" })),
				imageId: t.Optional(t.String({ format: "uuid" })),
				startingChapter: t.Optional(t.Number({ minimum: 0 })),
				endingChapter: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
			}),
			response: { 200: versionWithRelationsShape },
		},
	)

	.delete(
		"/:id",
		async ({ t, prisma, params: { id }, authedUser }) => {
			const existing = await prisma.keywordVersion.findUnique({
				where: { id },
				include: { ...versionInclude, keyword: true },
			});

			if (!existing) {
				throw new HttpError({ statusCode: 404, message: t({ en: "Version not found", ar: "النسخة غير موجودة" }) });
			}

			assertOwnsResource(existing.keyword.createdById, authedUser);

			const versionCount = await prisma.keywordVersion.count({ where: { keywordId: existing.keywordId } });
			if (versionCount <= 1) {
				throw new HttpError({
					message: t({ en: "Cannot delete the only version of a keyword", ar: "لا يمكن حذف النسخة الوحيدة للكلمة المفتاحية" }),
				});
			}

			await prisma.keywordVersion.delete({ where: { id } });

			const { keyword: _kw, ...result } = existing;
			return result;
		},
		{
			params: t.Object({ id: t.String({ format: "uuid" }) }),
			response: { 200: versionWithRelationsShape },
		},
	);
