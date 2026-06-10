import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import fs from "node:fs";

interface WranglerConfig {
  queues?: {
    producers?: Array<{
      binding?: string;
      queue?: string;
    }>;
  };
}

function parseWranglerConfig(): WranglerConfig {
  const errors: ParseError[] = [];
  const config = parse(fs.readFileSync("wrangler.jsonc", "utf8"), errors, {
    allowTrailingComma: true,
  }) as WranglerConfig;

  if (errors.length > 0) {
    const message = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");

    throw new Error(`Unable to parse wrangler.jsonc: ${message}`);
  }

  return config;
}

export function getSchedulerQueueName(): string {
  const config = parseWranglerConfig();
  const queueName = config.queues?.producers
    ?.find((producer) => producer.binding === "SCHEDULER_QUEUE")
    ?.queue
    ?.trim();

  if (!queueName) {
    throw new Error("No Queue producer name was found in wrangler.jsonc.");
  }

  return queueName;
}
