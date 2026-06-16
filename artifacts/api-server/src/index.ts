import app from "./app";
import { logger } from "./lib/logger";
import { startAutonomousBot } from "./lib/autonomous-bot";

// ─── Crash recovery: log ma non uscire su errori non gestiti ─────────────────
process.on("uncaughtException", (err) => {
  logger.error({ err }, "⚠️  uncaughtException — server continua");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "⚠️  unhandledRejection — server continua");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start autonomous AI trading bot
  startAutonomousBot();
});
