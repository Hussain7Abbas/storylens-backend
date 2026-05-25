import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { seedChapters } from "./tables/chapters";
import { seedConfigs } from "./tables/configs";
import { seedWebsiteSelectors } from "./tables/website-selectors";
import { seedKeywordCategory } from "./tables/keyword-category";
import { seedKeywordNature } from "./tables/keyword-nature";
import { seedKeywordReplacement } from "./tables/keyword-replacement";
import { seedKeywords } from "./tables/keywords";
import { seedKeywordsChapters } from "./tables/keywords-chapters";
import { seedNovels } from "./tables/novels";
import { seedRootAdmin } from "./tables/root-admin";

const prisma = new PrismaClient();

async function main() {
	await seedRootAdmin(prisma);
	await seedConfigs(prisma);
	await seedWebsiteSelectors(prisma);

	if (env.NODE_ENV === "development") {
		await seedKeywordCategory(prisma);
		await seedKeywordNature(prisma);
		await seedNovels(prisma);
		await seedChapters(prisma);
		await seedKeywords(prisma);
		await seedKeywordsChapters(prisma);
		await seedKeywordReplacement(prisma);
	}
}

await main()
	.then(async () => {
		await prisma.$disconnect();
	})
	.catch(async (e) => {
		console.error(e);
		await prisma.$disconnect();
		process.exit(1);
	});
