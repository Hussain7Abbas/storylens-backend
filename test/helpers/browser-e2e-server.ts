// Local browser integration fixture. Never run this against an existing database.
const databaseName = process.env.STORYLENS_E2E_DATABASE;
if (!databaseName || !/^storylens_lenses_e2e_[a-z0-9]+$/.test(databaseName)) {
  throw new Error("Requires a freshly created storylens_lenses_e2e_* database");
}
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(databaseUrl.hostname)) {
  throw new Error("Browser fixtures require loopback PostgreSQL");
}
databaseUrl.pathname = `/${databaseName}`;
process.env.DATABASE_URL = databaseUrl.toString();
process.env.NODE_ENV = "test";
process.env.RESEND_API_KEY = "";
process.env.EMAIL_FROM = "";
process.env.OPENROUTER_API_KEY = "";
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";
process.env.BETTER_AUTH_SECRET =
  "local-browser-fixture-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:7041";
process.env.WEBSITE_URL = "http://localhost:4173";
process.env.DASHBOARD_URL = "http://localhost:4174";
process.env.WEB_SESSION_INSECURE_COOKIE = "true";
process.env.DASHBOARD_ADMIN_EMAIL = "owner@example.test";
process.env.DASHBOARD_ADMIN_USERNAME = "e2eowner";
process.env.DASHBOARD_ADMIN_PASSWORD = "local-browser-owner-password";

if (process.argv.includes("--audit")) {
  const { prisma } = await import("@/lib/db");
  const { auditBalances } = await import("@/lib/billing/ledger");
  const mismatches = await auditBalances(prisma);
  console.log(
    JSON.stringify({
      mismatches,
      actions: await prisma.aiAction.count(),
      calls: await prisma.aiCall.count(),
    }),
  );
  await prisma.$disconnect();
  process.exit(mismatches.length ? 1 : 0);
}

const migrate = Bun.spawn(["bun", "run", "db:migrate:deploy"], {
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
});
if ((await migrate.exited) !== 0) throw new Error("Fixture migrations failed");

const { prisma } = await import("@/lib/db");
const { seedDashboardAdmin } = await import(
  "../../prisma/seed/tables/dashboard-admin"
);
const { setAiProvider } = await import("@/lib/ai/provider");
const { fakeAi } = await import("./fake-ai");
const ai = fakeAi();
setAiProvider({
  async chat(input) {
    ai.steps.push(
      input.prompt.includes("[e2e:cancel]")
        ? { kind: "hang" }
        : { kind: "ok", text: "A local fixture answer in English." },
    );
    return ai.provider.chat(input);
  },
  image: ai.provider.image,
});
await seedDashboardAdmin(prisma);
await prisma.config.update({
  where: { key: "AI_Cloud_Enabled" },
  data: { value: "true" },
});
await prisma.config.upsert({
  where: { key: "AI_Reader_Max_Per_10_Min" },
  create: { key: "AI_Reader_Max_Per_10_Min", value: "500" },
  update: { value: "500" },
});

const { syncPermissions } = await import("@/lib/permissions");
const { app } = await import("@/server");
await syncPermissions(prisma, app.routes);
app.listen({ hostname: "localhost", port: 7041, idleTimeout: 120 });
console.log("STORYLENS_BROWSER_E2E_READY");
