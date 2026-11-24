import type { NextConfig } from "next";

/** Sent on every response. No CSP yet: the app uses inline styles/scripts that a strict policy would break. */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }, // family links carry a secret in the path
  { key: "Permissions-Policy", value: "microphone=(self), camera=(self), geolocation=(self), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=15552000" }, // browsers apply it on https only
];

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // PinkyBua knowledge base is read at runtime; include it in the standalone output.
  outputFileTracingIncludes: { "/api/assistant/**": ["./src/lib/assistant/kb/**"] },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default config;
