/**
 * Copyright 2025 Schemaful
 *
 * This file is part of Schemaful Cloud.
 * See LICENSE for licensing terms.
 */

import express from "express";
import { createServer as createViteServer } from "vite";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext, type User } from "@schemaful/trpc";
import { createCms } from "@schemaful/cms";
import {
  handleAuth,
  getSession,
  getAuthjsConfig,
} from "@schemaful-ee/auth";
import { createWebhookHandler } from "@schemaful-ee/billing";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const isProduction = process.env.NODE_ENV === "production";

// ANSI color codes for CLI output
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

interface ConfigCheck {
  name: string;
  envVars: string[];
  required: boolean;
  description: string;
}

const configChecks: ConfigCheck[] = [
  {
    name: "Cloud Database",
    envVars: ["DATABASE_URL"],
    required: true,
    description: "PostgreSQL connection string for cloud metadata",
  },
  {
    name: "Auth.js",
    envVars: ["AUTH_SECRET"],
    required: true,
    description: "Secret for session encryption",
  },
  {
    name: "Google OAuth",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    required: false,
    description: "Google OAuth credentials",
  },
  {
    name: "Stripe",
    envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    required: false,
    description: "Stripe billing integration",
  },
  {
    name: "Neon API",
    envVars: ["NEON_API_KEY"],
    required: false,
    description: "Neon database provisioning",
  },
];

/**
 * Check configuration and print status
 */
function checkConfiguration(): boolean {
  console.log(
    `\n${colors.bold}${colors.cyan}ContentFern Cloud${colors.reset}`
  );
  console.log(`${colors.dim}─────────────────────${colors.reset}\n`);

  let canStart = true;

  for (const check of configChecks) {
    const configured = check.envVars.every((v) => !!process.env[v]);
    const partial = check.envVars.some((v) => !!process.env[v]);

    if (configured) {
      console.log(`${colors.green}✓${colors.reset} ${check.name}`);
    } else if (check.required) {
      console.log(
        `${colors.red}✗${colors.reset} ${check.name} ${colors.red}(required)${colors.reset}`
      );
      console.log(`  ${colors.dim}${check.description}${colors.reset}`);
      console.log(
        `  ${colors.dim}Missing: ${check.envVars.filter((v) => !process.env[v]).join(", ")}${colors.reset}`
      );
      canStart = false;
    } else if (partial) {
      console.log(
        `${colors.yellow}⚠${colors.reset} ${check.name} ${colors.yellow}(partial)${colors.reset}`
      );
      console.log(
        `  ${colors.dim}Missing: ${check.envVars.filter((v) => !process.env[v]).join(", ")}${colors.reset}`
      );
    } else {
      console.log(
        `${colors.yellow}○${colors.reset} ${check.name} ${colors.dim}(optional)${colors.reset}`
      );
    }
  }
  console.log("");

  return canStart;
}

/**
 * Get cloud database connection
 */
function getCloudDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return drizzle(sql);
}

/**
 * Convert Express request to Fetch Request
 */
function expressToFetchRequest(req: express.Request): Request {
  const protocol = req.protocol;
  const host = req.get("host") ?? "localhost";
  const url = new URL(req.originalUrl, `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      if (Array.isArray(value)) {
        value.forEach((v) => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    }
  }

  return new Request(url.toString(), {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method)
      ? undefined
      : JSON.stringify(req.body),
  });
}

/**
 * Get user from Auth.js session for a workspace
 */
async function getUserFromSession(
  req: Request,
  workspaceDbUrl?: string
): Promise<User | null> {
  const session = await getSession(req);
  if (!session?.user) return null;

  return {
    id: session.user.id!,
    email: session.user.email!,
    name: session.user.name ?? null,
    role: "admin", // In cloud, workspace members have roles managed separately
  };
}

/**
 * Handle tRPC requests for a specific workspace
 */
async function handleTrpcRequest(
  req: Request,
  workspaceDbUrl?: string
): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () =>
      createContext({
        getUser: () => getUserFromSession(req, workspaceDbUrl),
        requestId: req.headers.get("x-request-id") ?? undefined,
        updateImportProgress: () => {}, // TODO: implement for cloud
        // Pass workspace DB URL for multi-tenant CMS operations
        databaseUrl: workspaceDbUrl,
      }),
    onError({ error, path }) {
      console.error(`tRPC error on ${path}:`, error);
    },
  });
}

/**
 * Main server
 */
async function startServer() {
  // Check configuration before starting
  if (!checkConfiguration()) {
    console.error(
      `${colors.red}${colors.bold}Cannot start - missing required configuration${colors.reset}\n`
    );
    process.exit(1);
  }

  const app = express();

  // Raw body parser for Stripe webhooks (must come before express.json())
  app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }));

  // Parse JSON bodies
  app.use(express.json());

  // Auth.js routes
  app.all("/api/auth/*", async (req, res) => {
    try {
      const fetchReq = expressToFetchRequest(req);
      const response = await handleAuth(fetchReq);

      res.status(response.status);
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      const body = await response.text();
      res.send(body);
    } catch (error) {
      console.error("Auth handler error:", error);
      res.status(500).json({ error: "Authentication error" });
    }
  });

  // Stripe webhook handler
  app.post("/api/webhooks/stripe", async (req, res) => {
    try {
      const signature = req.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        return res.status(400).json({ error: "Missing stripe-signature header" });
      }

      const db = getCloudDb();
      const handler = createWebhookHandler(db as any);
      const result = await handler(req.body, signature);

      if (result.success) {
        res.json({ received: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Stripe webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Workspace-scoped tRPC API handler
  // Pattern: /api/workspaces/:slug/trpc/*
  app.all("/api/workspaces/:slug/trpc/*", async (req, res) => {
    try {
      const { slug } = req.params;

      // TODO: Look up workspace DB URL from cloud database
      // For now, use a placeholder - in production this would query the workspaces table
      const workspaceDbUrl = process.env.DATABASE_URL; // Placeholder

      const fetchReq = expressToFetchRequest(req);
      const fetchRes = await handleTrpcRequest(fetchReq, workspaceDbUrl);

      res.status(fetchRes.status);
      fetchRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      const body = await fetchRes.text();
      res.send(body);
    } catch (error) {
      console.error("tRPC handler error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Cloud management tRPC API (for workspace management, billing, etc.)
  app.all("/api/trpc/*", async (req, res) => {
    try {
      const fetchReq = expressToFetchRequest(req);
      const fetchRes = await handleTrpcRequest(fetchReq);

      res.status(fetchRes.status);
      fetchRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      const body = await fetchRes.text();
      res.send(body);
    } catch (error) {
      console.error("tRPC handler error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  if (isProduction) {
    // Production: serve built assets
    const { default: sirv } = await import("sirv");
    app.use(sirv("dist/client", { gzip: true }));
  } else {
    // Development: use Vite dev server
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
  }

  // Vike SSR handler
  app.get("*", async (req, res, next) => {
    try {
      // Skip API routes
      if (req.url.startsWith("/api/")) {
        return next();
      }

      const { renderPage } = await import("vike/server");

      const pageContext = await renderPage({
        urlOriginal: req.originalUrl,
        headersOriginal: req.headers,
      });

      const { httpResponse } = pageContext;

      if (!httpResponse) {
        return next();
      }

      const { statusCode, headers } = httpResponse;

      res.status(statusCode);
      headers.forEach(([name, value]) => res.setHeader(name, value));

      // Pipe the response body
      httpResponse.pipe(res);
    } catch (error) {
      console.error("Vike render error:", error);
      next(error);
    }
  });

  app.listen(PORT, () => {
    console.log(
      `${colors.green}→${colors.reset} Server running at ${colors.cyan}http://localhost:${PORT}${colors.reset}`
    );
    console.log(
      `${colors.dim}  Mode: ${isProduction ? "production" : "development"}${colors.reset}\n`
    );
  });
}

startServer().catch(console.error);
