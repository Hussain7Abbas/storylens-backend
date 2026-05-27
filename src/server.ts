import { Elysia, status } from "elysia";
import { cors, crons, logError, logger, openapi, queryParser } from "./plugins";
import { accounts } from "./routes/accounts";
import { ai } from "./routes/ai";
import { chapters } from "./routes/chapters";
import { configs } from "./routes/configs";
import { files } from "./routes/files";
import { keywordCategories } from "./routes/keyword-categories";
import { keywordNatures } from "./routes/keyword-natures";
import { keywords } from "./routes/keywords";
import { keywordsChapters } from "./routes/keywords-chapters";
import { novels } from "./routes/novels";
import { replacements } from "./routes/replacements";
import { websiteSelectors } from "./routes/website-selectors";
import { errorSchema } from "./schemas/common";
import { AuthError, HttpError } from "./utils/errors";

export const app = new Elysia()
	.use(logger)
	.use(cors)
	.use(openapi)
	.use(crons)
	.use(queryParser)

	.error({ HttpError, AuthError })
	.onError(({ code, error, request, path, set }) => {
		if (code === "HttpError") {
			logError({
				method: request.method,
				path,
				code,
				status: error.statusCode,
				message: error.message,
			});

			return status(error.statusCode, { message: error.message });
		}

		if (code === "AuthError") {
			logError({
				method: request.method,
				path,
				code,
				status: 401,
				message: error.message,
			});

			return status(401, { message: error.message });
		}

		const statusCode = typeof set.status === "number" ? set.status : 500;
		const message = error instanceof Error ? error.message : String(error);
		const stack = error instanceof Error ? error.stack : undefined;

		logError({
			method: request.method,
			path,
			code,
			status: statusCode,
			message,
			stack,
		});
	})
	.guard({
		response: {
			404: errorSchema,
			500: errorSchema,
		},
	})

	// Routes
	.get("/", () => ({
		message: "Made with ❤️ by Hussain Abbas, for docs checkout /docs",
	}))

	.use(accounts)
	.use(configs)
	.use(websiteSelectors)
	.use(novels)
	.use(chapters)
	.use(keywords)
	.use(replacements)
	.use(keywordsChapters)
	.use(keywordCategories)
	.use(keywordNatures)
	.use(files)
	.use(ai);
