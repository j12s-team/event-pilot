const SECRET_KEYS = new Set([
  "adminToken",
  "ADMIN_TOKEN",
  "authorization",
  "cookie",
  "demoPrivateKey",
  "DEMO_PRIVATE_KEY",
  "privateKey",
  "x-admin-token",
]);

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SECRET_KEYS.has(key) || /private.?key|secret|token|authorization|cookie/i.test(key)
          ? "[REDACTED]"
          : redactSecrets(child),
      ]),
    );
  }
  return value;
}

export const loggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-admin-token",
      "*.privateKey",
      "*.demoPrivateKey",
      "*.ADMIN_TOKEN",
      "*.DEMO_PRIVATE_KEY",
    ],
    censor: "[REDACTED]",
  },
};
