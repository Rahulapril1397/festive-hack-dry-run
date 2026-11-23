/**
 * Stage 2: mock integrations only in tests and local development. In staging and production a
 * missing key means "off" (safe fallback), never fake data.
 */
export function mockAllowed(): boolean {
  return process.env.NODE_ENV === "test" || (process.env.APP_ENV ?? "local") === "local";
}
