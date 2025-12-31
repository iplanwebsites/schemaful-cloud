/**
 * Copyright 2025 Schemaful
 *
 * This file is part of Schemaful Cloud.
 * See LICENSE for licensing terms.
 */

import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import vike from "vike/plugin";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cloudRoot = path.resolve(__dirname, "../..");
const ossRoot = path.resolve(cloudRoot, "../schemaful");
const eeRoot = path.resolve(cloudRoot, "../schemaful-ee");

export default defineConfig({
  plugins: [
    vike({
      prerender: false,
    }),
    react(),
    tailwindcss(),
  ],

  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react/") ||
            id.includes("node_modules/@radix-ui/")
          ) {
            return "vendor-react";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "vendor-icons";
          }
        },
      },
    },
  },

  server: {
    port: 3001,
    strictPort: false,
  },

  preview: {
    port: 3001,
    strictPort: false,
  },

  resolve: {
    extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
    alias: {
      "@": __dirname,
      // Core packages from schemaful (OSS)
      "@schemaful/cms": path.resolve(ossRoot, "packages/cms/src/index.ts"),
      "@schemaful/trpc/client": path.resolve(ossRoot, "packages/trpc/src/client.ts"),
      "@schemaful/trpc/react": path.resolve(ossRoot, "packages/trpc/src/react.ts"),
      "@schemaful/trpc": path.resolve(ossRoot, "packages/trpc/src/index.ts"),
      "@schemaful/shared": path.resolve(ossRoot, "packages/shared/src/index.ts"),
      "@schemaful/ui": path.resolve(ossRoot, "packages/ui/dist/index.js"),
      // EE packages from schemaful-ee
      "@schemaful-ee/auth": path.resolve(eeRoot, "packages/auth/src/index.ts"),
      "@schemaful-ee/billing": path.resolve(eeRoot, "packages/billing/src/index.ts"),
      "@schemaful-ee/provisioning": path.resolve(eeRoot, "packages/provisioning/src/index.ts"),
      "@schemaful-ee/limits": path.resolve(eeRoot, "packages/limits/src/index.ts"),
      "@schemaful-ee/admin": path.resolve(eeRoot, "packages/admin/src/index.ts"),
    },
    dedupe: ["react", "react-dom", "@radix-ui/react-slot"],
  },

  publicDir: "public",

  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@radix-ui/react-slot",
      "@tanstack/react-query",
    ],
  },

  ssr: {
    target: "node",
    noExternal: [
      "@schemaful/cms",
      "@schemaful/shared",
      "@schemaful/trpc",
      "@schemaful/ui",
      "@schemaful-ee/auth",
      "@schemaful-ee/billing",
      "@schemaful-ee/provisioning",
      "@schemaful-ee/limits",
      "@schemaful-ee/admin",
      /^@schemaful\/.*/,
      /^@schemaful-ee\/.*/,
      "sonner",
      "lucide-react",
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
    ],
  },
});
