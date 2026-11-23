/**
 * Mock integrations exist only for the automated test suite (NODE_ENV=test). Everywhere else —
 * local development included — a missing key means the integration is off (safe fallback),
 * never fake data.
 */
export function mockAllowed(): boolean {
  return process.env.NODE_ENV === "test";
}
