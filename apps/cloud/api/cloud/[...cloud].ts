/**
 * Copyright 2025 Schemaful
 *
 * Vercel API route for Cloud tRPC (workspace management, billing, etc.)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { initTRPC } from "@trpc/server";
import { getSession } from "@schemaful-ee/auth";
import { workspacesRouter } from "../../server/routers/workspaces.js";

// ============================================================================
// Types
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

// ============================================================================
// tRPC Setup
// ============================================================================

const t = initTRPC.context<CloudContext>().create();

/**
 * Cloud Router
 * Provides workspace management, billing, and other cloud-specific APIs
 */
const cloudRouter = t.router({
  workspaces: workspacesRouter,
});

export type CloudRouter = typeof cloudRouter;

// ============================================================================
// Request Handling
// ============================================================================

/**
 * Get user from Auth.js session
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
 * Convert Vercel request to Fetch Request
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
// Handler
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const fetchReq = vercelToFetchRequest(req);

  const response = await fetchRequestHandler({
    endpoint: "/api/cloud",
    req: fetchReq,
    router: cloudRouter,
    createContext: async () => ({
      user: await getCloudUserFromSession(fetchReq),
    }),
    onError({ error, path }) {
      console.error(`Cloud tRPC error on ${path}:`, error);
    },
  });

  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const body = await response.text();
  res.send(body);
}
