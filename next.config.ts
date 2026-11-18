import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: { "/api/services": ["./scripts/validate-service-pdf.mjs", "./node_modules/pdf-lib/**/*", "./node_modules/@pdf-lib/**/*", "./node_modules/pako/**/*", "./node_modules/tslib/**/*"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
