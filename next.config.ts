import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a wasm binary and uses Node built-ins; keep it external to the
  // server bundle so Next doesn't try to bundle the wasm module.
  serverExternalPackages: ["@electric-sql/pglite"],

  // On Vercel, the server bundle is built by file-tracing only the imports it
  // detects — which misses PGlite's `.wasm`/`.data` runtime assets, so the
  // function crashes at boot with a missing-file error. Force them in.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@electric-sql/pglite/dist/*"],
  },
};

export default nextConfig;
