import type { PrismaClient } from "@prisma/client";
import { withLensChange } from "@/lib/billing/ledger";

/** Development only: every registered reader gets 25 lenses once, so cloud AI can be tried locally. */
export async function seedLenses(prisma: PrismaClient) {
	console.log("🌱", "Seeding lenses");

	const readers = await prisma.user.findMany({
		where: { isUser: true, isGuest: false },
		select: { id: true },
	});
	for (const reader of readers) {
		// The key makes a second seed run change nothing.
		await withLensChange(prisma, {
			userId: reader.id,
			delta: 25,
			type: "ADMIN_ADJUSTMENT",
			idempotencyKey: `seed:${reader.id}`,
			note: "Development seed",
		});
	}
}
