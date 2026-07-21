const SENSITIVE_KEY = /(?:rate|amount|subtotal|gst|total|price|cost|secret|password|token|authorization|cookie)/i;

export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item),
    ]),
  ) as T;
}

export const logger = {
  info(message: string, data?: unknown) {
    console.info(JSON.stringify({ level: "info", message, data: redact(data) }));
  },
  error(message: string, error?: unknown) {
    const safe = error instanceof Error ? { name: error.name, message: error.message } : redact(error);
    console.error(JSON.stringify({ level: "error", message, error: safe }));
  },
};
