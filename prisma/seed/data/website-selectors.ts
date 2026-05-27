import type { WebsiteSelector } from "@prisma/client";

export const websiteSelectors: WebsiteSelector[] = [
	{
		id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		website: "rewayat.club",
		novelXpathValue:
			"//h1[contains(@class, 'headerClassRTL')]",
		novelXpathRegex: "(.*)",
		novelUrlRegex: "rewayat\\.club/novel/([^/]+)/",
		chapterXpathValue:
			"//div[contains(@class, 'v-card__subtitle') and contains(@class, 'headerClassRTL')]",
		chapterXpathRegex: "(\\d+)",
		chapterUrlRegex: "rewayat\\.club/novel/[^/]+/(\\d+)",
		createdAt: new Date("2026-05-25T00:41:13.337Z"),
		updatedAt: new Date("2026-05-25T21:35:07.705Z"),
	},
	{
		id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
		website: "cenele.com",
		novelXpathValue: "//meta[@property='og:title']/@content",
		novelXpathRegex: "(.*)\\s+-\\s+الفصل\\s+\\d+\\s+-\\s+فضاء الروايات",
		novelUrlRegex: "/cont/([^/]+)/",
		chapterXpathValue: "//h3[@class='chapter-name']",
		chapterXpathRegex: "الفصل\\s+(\\d+)",
		chapterUrlRegex: "%d8%a7%d9%84%d9%81%d8%b5%d9%84-(\\d+)",
		createdAt: new Date("2026-05-25T00:41:13.337Z"),
		updatedAt: new Date("2026-05-25T21:35:07.705Z"),
	},
	{
		id: "c3d4e5f6-a7b8-9012-cdef-123456789012",
		website: "mknov.com",
		novelXpathValue:
			"/html/head/meta[@property='og:title']/@content",
		novelXpathRegex: "الفصل \\d+ من رواية (.*?) - .*",
		novelUrlRegex: "([^/]+)",
		chapterXpathValue:
			"/html/head/meta[@property='og:title']/@content",
		chapterXpathRegex: "الفصل (\\d+)",
		chapterUrlRegex: "(\\d+)",
		createdAt: new Date("2026-05-25T00:41:13.337Z"),
		updatedAt: new Date("2026-05-25T21:35:07.705Z"),
	},
];
