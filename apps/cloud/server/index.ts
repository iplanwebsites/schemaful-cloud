/**
 * Copyright 2025 Schemaful
 *
 * This file is part of Schemaful Cloud.
 * See LICENSE for licensing terms.
 */

import express from "express";
import { createServer as createViteServer } from "vite";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { initTRPC } from "@trpc/server";
import { appRouter, createContext, type User } from "@schemaful/trpc";
import { handleAuth, getSession, hashPassword, cloudUsers, workspaces, workspaceMembers } from "@schemaful-ee/auth";
import { provisionDatabase } from "@schemaful-ee/provisioning";
import { createWebhookHandler } from "@schemaful-ee/billing";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { workspacesRouter } from "./routers/workspaces.js";

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

// ============================================================================
// Cloud tRPC Router
// ============================================================================

interface CloudUser {
  id: string;
  email: string;
  name: string | null;
  isSuperAdmin?: boolean;
}

interface CloudContext {
  user: CloudUser | null;
}

const t = initTRPC.context<CloudContext>().create();

/**
 * Cloud App Router
 * Combines the base CMS app router with cloud-specific features (workspaces, billing)
 */
const cloudRouter = t.router({
  workspaces: workspacesRouter,
});

export type CloudRouter = typeof cloudRouter;

/**
 * Get user from Auth.js session for cloud context
 */
async function getCloudUserFromSession(req: Request): Promise<CloudUser | null> {
  const session = await getSession(req);
  if (!session?.user) return null;

  return {
    id: session.user.id!,
    email: session.user.email!,
    name: session.user.name ?? null,
    isSuperAdmin: false, // TODO: Check from database if needed
  };
}

/**
 * Handle tRPC requests for cloud management APIs (workspaces, billing, etc.)
 */
async function handleCloudTrpcRequest(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api/cloud",
    req,
    router: cloudRouter,
    createContext: async () => ({
      user: await getCloudUserFromSession(req),
    }),
    onError({ error, path }) {
      console.error(`Cloud tRPC error on ${path}:`, error);
    },
  });
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
async function getUserFromSession(req: Request): Promise<User | null> {
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
async function handleTrpcRequest(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () =>
      createContext({
        getUser: () => getUserFromSession(req),
        requestId: req.headers.get("x-request-id") ?? undefined,
        updateImportProgress: () => {}, // TODO: implement for cloud
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

  // Signup validation schema
  const signupSchema = z.object({
    name: z.string().min(1, "Name is required").max(255, "Name too long"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
  });

  // Signup route (must come before general Auth.js routes)
  app.post("/api/auth/signup", async (req, res) => {
    try {
      // Validate request body
      const parseResult = signupSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errors = parseResult.error.flatten();
        return res.status(400).json({
          error: "Validation failed",
          details: errors.fieldErrors,
        });
      }

      const { name, email, password } = parseResult.data;
      const normalizedEmail = email.toLowerCase();

      const db = getCloudDb();

      // Check if user already exists
      const [existingUser] = await db
        .select({ id: cloudUsers.id })
        .from(cloudUsers)
        .where(eq(cloudUsers.email, normalizedEmail))
        .limit(1);

      if (existingUser) {
        return res.status(409).json({
          error: "An account with this email already exists",
          code: "EMAIL_EXISTS",
        });
      }

      // Hash the password using Argon2id
      const passwordHash = await hashPassword(password);

      // Create the user
      const userId = crypto.randomUUID();
      await db.insert(cloudUsers).values({
        id: userId,
        name,
        email: normalizedEmail,
        passwordHash,
        emailVerified: null,
      });

      // Return success - client will use credentials to sign in
      return res.status(201).json({
        success: true,
        message: "Account created successfully",
        redirectUrl: "/workspaces/new",
      });
    } catch (error) {
      console.error("Signup error:", error);
      return res.status(500).json({
        error: "An error occurred while creating your account",
      });
    }
  });

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

      res.json({ received: result.received, eventType: result.eventType });
    } catch (error) {
      console.error("Stripe webhook error:", error);
      res.status(400).json({ error: "Webhook processing failed" });
    }
  });

  // Workspaces REST API (create and list workspaces)
  app.get("/api/workspaces", async (req, res) => {
    try {
      const fetchReq = expressToFetchRequest(req);
      const session = await getSession(fetchReq);

      if (!session?.user) {
        return res.status(401).json({
          error: "Authentication required",
          code: "UNAUTHORIZED",
        });
      }

      const db = getCloudDb();

      // Get all workspaces where user is a member
      const userWorkspaces = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          slug: workspaces.slug,
          plan: workspaces.plan,
          role: workspaceMembers.role,
          createdAt: workspaces.createdAt,
        })
        .from(workspaces)
        .innerJoin(workspaceMembers, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(eq(workspaceMembers.userId, session.user.id));

      return res.status(200).json({
        workspaces: userWorkspaces,
      });
    } catch (error) {
      console.error("Error listing workspaces:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/workspaces", async (req, res) => {
    try {
      const fetchReq = expressToFetchRequest(req);
      const session = await getSession(fetchReq);

      if (!session?.user) {
        return res.status(401).json({
          error: "Authentication required",
          code: "UNAUTHORIZED",
        });
      }

      // Validate request body
      const createWorkspaceSchema = z.object({
        name: z.string().min(1, "Workspace name is required").max(100, "Workspace name is too long"),
        slug: z
          .string()
          .min(3, "Slug must be at least 3 characters")
          .max(50, "Slug must be at most 50 characters")
          .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, "Invalid slug format"),
      });

      const parseResult = createWorkspaceSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errors = parseResult.error.flatten();
        return res.status(400).json({
          error: "Validation failed",
          details: errors.fieldErrors,
        });
      }

      const { name, slug } = parseResult.data;
      const db = getCloudDb();

      // Check if slug is already taken
      const [existingWorkspace] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, slug))
        .limit(1);

      if (existingWorkspace) {
        return res.status(409).json({
          error: "This workspace URL is already taken",
          code: "SLUG_EXISTS",
        });
      }

      const workspaceId = crypto.randomUUID();

      // Provision the Neon database if configured
      let neonProjectId: string | undefined;
      let databaseUrl: string | undefined;
      let poolerUrl: string | undefined;

      if (process.env.NEON_API_KEY) {
        const provisionResult = await provisionDatabase(slug);
        if (!provisionResult.success) {
          console.error("Database provisioning failed:", provisionResult.error);
          return res.status(500).json({
            error: "Failed to provision database. Please try again.",
            code: "PROVISIONING_FAILED",
          });
        }
        neonProjectId = provisionResult.projectId;
        databaseUrl = provisionResult.connectionString;
        poolerUrl = provisionResult.poolerConnectionString;
      }

      // Insert workspace
      await db.insert(workspaces).values({
        id: workspaceId,
        name,
        slug,
        neonProjectId: neonProjectId ?? null,
        databaseUrl: databaseUrl ?? null,
        poolerUrl: poolerUrl ?? null,
        plan: "free",
        settings: {},
        isSuspended: false,
      });

      // Add the creator as owner
      await db.insert(workspaceMembers).values({
        workspaceId,
        userId: session.user.id,
        role: "owner",
      });

      return res.status(201).json({
        success: true,
        workspace: { id: workspaceId, name, slug },
        redirectUrl: `/workspaces/${slug}`,
      });
    } catch (error) {
      console.error("Error creating workspace:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Cloud management tRPC API (for workspace management, billing, etc.)
  // Pattern: /api/cloud/*
  app.all("/api/cloud/*", async (req, res) => {
    try {
      const fetchReq = expressToFetchRequest(req);
      const fetchRes = await handleCloudTrpcRequest(fetchReq);

      res.status(fetchRes.status);
      fetchRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      const body = await fetchRes.text();
      res.send(body);
    } catch (error) {
      console.error("Cloud tRPC handler error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Workspace-scoped tRPC API handler
  // Pattern: /api/workspaces/:slug/trpc/*
  app.all("/api/workspaces/:slug/trpc/*", async (req, res) => {
    try {
      // TODO: Look up workspace DB URL from cloud database using req.params.slug
      // For now, use a placeholder - in production this would query the workspaces table

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

  // CMS tRPC API (for CMS operations within a workspace)
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
