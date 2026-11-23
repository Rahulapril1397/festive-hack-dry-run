/**
 * Structured JSON logs for Cloud Logging (one line per entry; `severity` is understood natively).
 * Never log phones, names, amounts, keys or query strings: callers pass only fixed fields, and
 * free-text messages go through scrub().
 */
type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export function log(severity: Severity, message: string, fields: Record<string, string | number | boolean | null | undefined> = {}) {
  const line = JSON.stringify({ severity, message: scrub(message), time: new Date().toISOString(), ...fields });
  if (severity === "ERROR") console.error(line);
  else if (severity === "WARNING") console.warn(line);
  else console.log(line);
}

/** Masks digit runs (phones, amounts, codes), emails and long hex keys in free text. */
export function scrub(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\b[0-9a-f]{20,}\b/gi, "<key>")
    .replace(/\d{4,}/g, "<num>")
    .slice(0, 500);
}

/** Path for logs: ids kept (not personal), family link keys under /f/ masked, no query string. */
export function routeOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/f\/[^/]+/, "/f/<key>");
  } catch {
    return "<bad-url>";
  }
}

export function requestId(req: Request): string {
  const trace = req.headers.get("x-cloud-trace-context")?.split("/")[0];
  return trace || req.headers.get("x-request-id") || crypto.randomUUID();
}
