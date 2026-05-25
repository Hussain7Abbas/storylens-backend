import type { Config } from "@prisma/client";

export const configs: Config[] = [
	{
		id: "b84d17dc-0b57-4ec7-bdec-0d3466ef6803",
		key: "websitesSelectors",
		value:
			'{"rewayat.club":{"website":"rewayat.club","novel":{"xpath":{"value":"//h1[contains(@class, \'headerClassRTL\')]","regex":"(.*)"},"url":{"regex":"rewayat\\\\.club/novel/([^/]+)/"}},"chapter":{"xpath":{"value":"//div[contains(@class, \'v-card__subtitle\') and contains(@class, \'headerClassRTL\')]","regex":"(\\\\d+)"},"url":{"regex":"rewayat\\\\.club/novel/[^/]+/(\\\\d+)"}}},"cenele.com":{"website":"cenele.com","novel":{"xpath":{"value":"//meta[@property=\'og:title\']/@content","regex":"(.*)\\\\s+-\\\\s+الفصل\\\\s+\\\\d+\\\\s+-\\\\s+فضاء الروايات"},"url":{"regex":"/cont/([^/]+)/"}},"chapter":{"xpath":{"value":"//h3[@class=\'chapter-name\']","regex":"الفصل\\\\s+(\\\\d+)"},"url":{"regex":"%d8%a7%d9%84%d9%81%d8%b5%d9%84-(\\\\d+)"}}},"mknov.com":{"website":"mknov.com","novel":{"xpath":{"value":"/html/head/meta[@property=\'og:title\']/@content","regex":"الفصل \\\\d+ من رواية (.*?) - .*"},"url":{"regex":"([^/]+)"}},"chapter":{"xpath":{"value":"/html/head/meta[@property=\'og:title\']/@content","regex":"الفصل (\\\\d+)"},"url":{"regex":"(\\\\d+)"}}}}',
		createdAt: new Date("2026-05-25T00:41:13.337Z"),
		updatedAt: new Date("2026-05-25T21:35:07.705Z"),
	},
];
