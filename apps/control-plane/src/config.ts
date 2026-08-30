import { SHANNON_CHAIN_ID } from "@eventpilot/contracts";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4_100),
  CORS_ORIGIN: z.string().default("http://127.0.0.1:3000"),
  DATABASE_PATH: z.string().default("./data/eventpilot.db"),
  SOMNIA_CHAIN_ID: z.coerce.number().int().default(SHANNON_CHAIN_ID),
  SOMNIA_INDEXER_URL: z.string().url().default("https://dev.smk.somnia.host/v1/graphql"),
  SOMNIA_WS_RPC_URL: z.string().url().default("wss://api.infra.testnet.somnia.network/ws"),
  SOMNIA_RPC_URL: z.string().url().default("https://dream-rpc.somnia.network"),
  DRY_RUN: booleanString,
  MARKET_MODE: z.enum(["fixture", "live"]).default("fixture"),
  ADMIN_TOKEN: z.string().min(24).default("local-development-token-change-me"),
  DEMO_PRIVATE_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
  ),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = configSchema.parse(environment);
  if (config.SOMNIA_CHAIN_ID !== SHANNON_CHAIN_ID) {
    throw new Error(
      `EventPilot refuses chain ${config.SOMNIA_CHAIN_ID}; Shannon ${SHANNON_CHAIN_ID} is required.`,
    );
  }
  if (!config.DRY_RUN && !config.DEMO_PRIVATE_KEY) {
    throw new Error("DEMO_PRIVATE_KEY is required when DRY_RUN=false.");
  }
  if (!config.DRY_RUN && config.MARKET_MODE !== "live") {
    throw new Error("MARKET_MODE=live is required when DRY_RUN=false.");
  }
  return config;
}
