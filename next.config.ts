import type { NextConfig } from "next";

const pdfValidationFiles = ["./scripts/validate-service-pdf.mjs", "./node_modules/pdf-lib/**/*", "./node_modules/@pdf-lib/**/*", "./node_modules/pako/**/*", "./node_modules/tslib/**/*"];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: { "/api/services": pdfValidationFiles, "/api/portfolio": pdfValidationFiles },
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
