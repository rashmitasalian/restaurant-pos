import { validationMessage } from "../../shared/validation";
import { logger } from "./logger";

/** Log the underlying failure and return a safe message for UI display. */
export function reportClientError(
  scope: string,
  error: unknown,
  defaultMessage = "Something went wrong. Please try again.",
  context?: Record<string, unknown>,
): string {
  const err = error instanceof Error ? error : new Error(String(error ?? "unknown"));
  logger.error(`[${scope}] ${defaultMessage}`, err, context);
  return validationMessage(error, defaultMessage);
}
