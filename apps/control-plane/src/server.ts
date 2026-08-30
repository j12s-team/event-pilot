import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app } = await buildApp(config);

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
