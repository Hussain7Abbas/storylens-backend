import type { PrismaClient } from "@prisma/client";
import { websiteSelectors } from "../data/website-selectors";

export async function seedWebsiteSelectors(prisma: PrismaClient) {
	console.log("🌱", "Seeding website selectors");

	await prisma.websiteSelector.createMany({
		data: websiteSelectors,
		skipDuplicates: true,
	});
}
