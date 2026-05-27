import type { PrismaClient } from "@prisma/client";
import { configs } from "../data/configs";

export async function seedConfigs(prisma: PrismaClient) {
	console.log("🌱", "Seeding config");

	await prisma.config.createMany({
		data: configs,
	});
}
