import { Elysia, status } from "elysia";
import { cors, crons, logError, logger, openapi, queryParser } from "./plugins";
import { adminApi } from "./routes/admin";
import { betterAuthRoutes } from "./routes/better-auth";
import { health } from "./routes/health";
import { userApi } from "./routes/user";
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

	.use(health)
	.use(betterAuthRoutes)
	.use(userApi)
	.use(adminApi);
