/**
 * Copyright 2025 Schemaful
 *
 * Vercel API route for workspace management
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSession, workspaces, workspaceMembers, cloudUsers } from "@schemaful-ee/auth";
import { provisionDatabase } from "@schemaful-ee/provisioning";

// ============================================================================
// Validation
// ============================================================================

const SLUG_MIN_LENGTH = 3;
const SLUG_MAX_LENGTH = 50;
const SLUG_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/**
 * Reserved slugs that cannot be used for workspaces
 */
const RESERVED_SLUGS = [
  "api",
  "admin",
  "auth",
  "app",
  "www",
  "mail",
  "ftp",
  "new",
  "create",
  "settings",
  "account",
  "billing",
  "support",
  "help",
  "docs",
  "documentation",
  "status",
  "health",
  "static",
  "assets",
  "cdn",
];

/**
 * Workspace creation request validation schema
 */
const createWorkspaceSchema = z.object({
  name: z
    .string()
    .min(1, "Workspace name is required")
    .max(100, "Workspace name is too long"),
  slug: z
    .string()
    .min(SLUG_MIN_LENGTH, `Slug must be at least ${SLUG_MIN_LENGTH} characters`)
    .max(SLUG_MAX_LENGTH, `Slug must be at most ${SLUG_MAX_LENGTH} characters`)
    .regex(SLUG_PATTERN, "Slug must start with a letter, end with a letter or number, and contain only lowercase letters, numbers, and hyphens")
    .refine((slug) => !slug.includes("--"), "Slug cannot contain consecutive hyphens")
    .refine((slug) => !RESERVED_SLUGS.includes(slug), "This slug is reserved"),
});

// ============================================================================
// Database
// ============================================================================

/**
 * Get cloud database connection
 */
function getCloudDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  const sql = neon(databaseUrl);
  return drizzle(sql);
}

/**
 * Convert Vercel request to Fetch Request for session handling
 */
function vercelToFetchRequest(req: VercelRequest): Request {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const url = new URL(req.url!, `${protocol}://${host}`);

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
    body: ["GET", "HEAD"].includes(req.method!)
      ? undefined
      : JSON.stringify(req.body),
  });
}

// ============================================================================
// Handlers
// ============================================================================

/**
 * Create a new workspace
 */
async function handleCreateWorkspace(req: VercelRequest, res: VercelResponse) {
  // Get user session
  const fetchReq = vercelToFetchRequest(req);
  const session = await getSession(fetchReq);

  if (!session?.user) {
    return res.status(401).json({
      error: "Authentication required",
      code: "UNAUTHORIZED",
    });
  }

  // Validate request body
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

  try {
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

    // Create the workspace record
    const workspaceId = crypto.randomUUID();

    // Provision the Neon database
    let neonProjectId: string | undefined;
    let databaseUrl: string | undefined;
    let poolerUrl: string | undefined;

    // Check if Neon API is configured
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
      workspace: {
        id: workspaceId,
        name,
        slug,
      },
      redirectUrl: `/workspaces/${slug}`,
    });
  } catch (error) {
    console.error("Error creating workspace:", error);
    return res.status(500).json({
      error: "An error occurred while creating the workspace",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * List workspaces for the current user
 */
async function handleListWorkspaces(req: VercelRequest, res: VercelResponse) {
  // Get user session
  const fetchReq = vercelToFetchRequest(req);
  const session = await getSession(fetchReq);

  if (!session?.user) {
    return res.status(401).json({
      error: "Authentication required",
      code: "UNAUTHORIZED",
    });
  }

  const db = getCloudDb();

  try {
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
    return res.status(500).json({
      error: "An error occurred while listing workspaces",
      code: "INTERNAL_ERROR",
    });
  }
}

// ============================================================================
// Main Handler
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  switch (req.method) {
    case "GET":
      return handleListWorkspaces(req, res);
    case "POST":
      return handleCreateWorkspace(req, res);
    default:
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
  }
}
