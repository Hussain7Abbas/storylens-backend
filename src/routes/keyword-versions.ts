import { Elysia, t } from "elysia";
import { FilePlain, KeywordCategoryPlain, KeywordNaturePlain, KeywordVersionPlain } from "@/lib/db";
import { assertNotStale, compareAndSwap } from "@/lib/sync/precondition";
import { createWithReplay, findReplay } from "@/lib/sync/replay";
import { assertOwnsAnyOf, authorize, canModerate } from "@/middleware/authorize";
import { paginationSchema, sortingSchema, staleWriteSchema } from "@/schemas/common";
import { setup } from "@/setup";
import { HttpError } from "@/utils/errors";
import { lockKeywordVersions } from "@/routes/admin/version-ranges";
import { getNestedColumnObject, parsePaginationProps } from "@/utils/helpers";
import { sanitizeObject } from "@/utils/sanitize";

const versionWithRelationsShape = t.Object({
	...KeywordVersionPlain.properties,
	category: t.Nullable(KeywordCategoryPlain),
	nature: t.Nullable(KeywordNaturePlain),
	image: t.Nullable(FilePlain),
});

const versionInclude = {
	category: true,
	nature: true,
	image: true,
} as const;

type Translate = (messages: { en: string; ar: string }) => string;

function parentNotFound(message: string): HttpError {
	return new HttpError({ statusCode: 404, code: "PARENT_NOT_FOUND", message });
}

function versionNotFound(t: Translate): HttpError {
	return new HttpError({ statusCode: 404, code: "NOT_FOUND", message: t({ en: "Version not found", ar: "النسخة غير موجودة" }) });
}

export const keywordVersions = new Elysia({ prefix: "/keyword-versions", tags: ["Keywords"] })
	.use(setup)
	.use(authorize('user'))

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


	// Any reader may add a version to any keyword (readers from their current chapter,
	// moderators at a chosen range). The client sends the version ID, so a replay
	// returns the same row without closing the previous version again.
	.post(
		"/",
		async ({ t, prisma, body, authedUser }) => {
			const findVersion = () => prisma.keywordVersion.findUnique({ where: { id: body.id }, include: versionInclude });
			const isReplay = (row: { createdById: string | null; keywordId: string }) =>
				row.createdById === authedUser.id && row.keywordId === body.keywordId;

			const replay = await findReplay(findVersion, isReplay, t);
			if (replay) return replay;

			const sanitizedBody = sanitizeObject(body);
			const { keywordId } = sanitizedBody;
			const categoryId = sanitizedBody.categoryId ?? null;
			const natureId = sanitizedBody.natureId ?? null;

			const [keyword, category, nature] = await Promise.all([
				prisma.keyword.findUnique({ where: { id: keywordId } }),
				categoryId ? prisma.keywordCategory.findUnique({ where: { id: categoryId } }) : Promise.resolve(null),
				natureId ? prisma.keywordNature.findUnique({ where: { id: natureId } }) : Promise.resolve(null),
			]);

			if (!keyword) throw parentNotFound(t({ en: "Keyword not found", ar: "الكلمة المفتاحية غير موجودة" }));
			if (categoryId && !category) throw parentNotFound(t({ en: "Category not found", ar: "الفئة غير موجودة" }));
			if (natureId && !nature) throw parentNotFound(t({ en: "Nature not found", ar: "الطبيعة غير موجودة" }));

			let startingChapter: number;
			let endingChapter: number | null = null;

			if (canModerate(authedUser)) {
				startingChapter = sanitizedBody.startingChapter ?? sanitizedBody.currentChapter ?? 0;
				endingChapter = sanitizedBody.endingChapter ?? null;
			} else {
				if (sanitizedBody.currentChapter == null) {
					throw new HttpError({
						statusCode: 400,
						code: "VERSION_CHAPTER_REQUIRED",
						message: t({ en: "currentChapter is required to add a version", ar: "currentChapter مطلوب لإضافة نسخة" }),
					});
				}
				startingChapter = sanitizedBody.currentChapter;
			}

			return createWithReplay(
				() =>
					prisma.$transaction(async (tx) => {
						await lockKeywordVersions(tx, keywordId);
						const latestVersion = await tx.keywordVersion.findFirst({
							where: { keywordId, endingChapter: null, id: { not: body.id } },
							orderBy: { startingChapter: "desc" },
						});
						if (latestVersion && startingChapter <= latestVersion.startingChapter) {
							throw new HttpError({
								statusCode: 400,
								code: "VERSION_NOT_AFTER_LATEST",
								message: t({ en: "startingChapter must be greater than the current latest version", ar: "يجب أن يكون startingChapter أكبر من النسخة الأخيرة الحالية" }),
							});
						}
						if (latestVersion) {
							await tx.keywordVersion.update({
								where: { id: latestVersion.id },
								data: { endingChapter: startingChapter - 1 },
							});
						}

						return tx.keywordVersion.create({
							data: {
								id: body.id,
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
					}),
				findVersion,
				isReplay,
				t,
			);
		},
		{
			body: t.Object({
				id: t.String({ format: "uuid" }),
				keywordId: t.String({ format: "uuid" }),
				categoryId: t.Optional(t.String({ format: "uuid" })),
				natureId: t.Optional(t.String({ format: "uuid" })),
				description: t.Optional(t.Nullable(t.String())),
				imageId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				currentChapter: t.Optional(t.Number({ minimum: 0 })),
				startingChapter: t.Optional(t.Number({ minimum: 0 })),
				endingChapter: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
			}),
			response: { 200: versionWithRelationsShape },
		},
	)

	// A moderator, the version's own creator or the parent keyword's creator may edit it.
	// Partial: only sent fields change; `null` clears the description or image. Chapter
	// ranges change only for moderators.
	.put(
		"/:id",
		async ({ t, prisma, params: { id }, body, authedUser }) => {
			const existing = await prisma.keywordVersion.findUnique({
				where: { id },
				include: { keyword: true },
			});

			if (!existing) throw versionNotFound(t);

			assertOwnsAnyOf([existing.createdById, existing.keyword.createdById], authedUser);
			await assertNotStale(
				existing,
				body.baseUpdatedAt,
				() => prisma.keywordVersion.findUniqueOrThrow({ where: { id }, include: versionInclude }),
				t,
			);

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
				if (sanitizedBody.categoryId && !category) throw parentNotFound(t({ en: "Category not found", ar: "الفئة غير موجودة" }));
				if (sanitizedBody.natureId && !nature) throw parentNotFound(t({ en: "Nature not found", ar: "الطبيعة غير موجودة" }));
			}

			const updateData: Record<string, unknown> = {
				description: sanitizedBody.description,
				categoryId: sanitizedBody.categoryId,
				natureId: sanitizedBody.natureId,
				imageId: sanitizedBody.imageId,
			};

			if (canModerate(authedUser)) {
				if (sanitizedBody.startingChapter !== undefined) updateData.startingChapter = sanitizedBody.startingChapter;
				if (sanitizedBody.endingChapter !== undefined) updateData.endingChapter = sanitizedBody.endingChapter;
			}

			return compareAndSwap(() => prisma.keywordVersion.update({
				where: { id, updatedAt: existing.updatedAt },
				data: updateData,
				include: versionInclude,
			}), () => prisma.keywordVersion.findUniqueOrThrow({ where: { id }, include: versionInclude }), t);
		},
		{
			params: t.Object({ id: t.String({ format: "uuid" }) }),
			body: t.Object({
				baseUpdatedAt: t.String({ format: "date-time" }),
				description: t.Optional(t.Nullable(t.String())),
				categoryId: t.Optional(t.String({ format: "uuid" })),
				natureId: t.Optional(t.String({ format: "uuid" })),
				imageId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
				startingChapter: t.Optional(t.Number({ minimum: 0 })),
				endingChapter: t.Optional(t.Nullable(t.Number({ minimum: 0 }))),
			}),
			response: { 200: versionWithRelationsShape, 409: staleWriteSchema(versionWithRelationsShape) },
		},
	)

	// Deletes are unconditional, except that the base and the only version are kept.
	.delete(
		"/:id",
		async ({ t, prisma, params: { id }, authedUser }) => {
			const existing = await prisma.keywordVersion.findUnique({
				where: { id },
				include: { ...versionInclude, keyword: true },
			});

			if (!existing) throw versionNotFound(t);

			assertOwnsAnyOf([existing.createdById, existing.keyword.createdById], authedUser);

			const [versionCount, baseVersion] = await Promise.all([
				prisma.keywordVersion.count({ where: { keywordId: existing.keywordId } }),
				prisma.keywordVersion.findFirst({
					where: { keywordId: existing.keywordId },
					orderBy: { startingChapter: "asc" },
					select: { id: true },
				}),
			]);

			if (versionCount <= 1) {
				throw new HttpError({
					statusCode: 400,
					code: "VERSION_ONLY_PROTECTED",
					message: t({ en: "Cannot delete the only version of a keyword", ar: "لا يمكن حذف النسخة الوحيدة للكلمة المفتاحية" }),
				});
			}

			if (baseVersion?.id === id) {
				throw new HttpError({
					statusCode: 400,
					code: "VERSION_BASE_PROTECTED",
					message: t({ en: "Cannot delete the base version of a keyword", ar: "لا يمكن حذف النسخة الأساسية للكلمة المفتاحية" }),
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
