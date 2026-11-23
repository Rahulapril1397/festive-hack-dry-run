import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // PinkyBua knowledge base is read at runtime; include it in the standalone output.
  outputFileTracingIncludes: { "/api/assistant/**": ["./src/lib/assistant/kb/**"] },
};

export default config;
