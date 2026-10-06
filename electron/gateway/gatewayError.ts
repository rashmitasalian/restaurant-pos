/** Application error codes are kebab-case. Database and runtime messages are not. */
const SAFE_ERROR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function publicGatewayError(message: unknown) {
  const text = String(message || "").trim();
  if (text.length > 0 && text.length <= 80 && SAFE_ERROR.test(text)) {
    return text;
  }
  return "internal-error";
}
