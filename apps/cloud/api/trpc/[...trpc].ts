/**
 * Copyright 2025 Schemaful
 *
 * Vercel API route for tRPC
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext, type User } from "@schemaful/trpc";
import { getSession } from "@schemaful-ee/auth";

/**
 * Get user from Auth.js session
 */
async function getUserFromSession(req: Request): Promise<User | null> {
  const session = await getSession(req);
  if (!session?.user) return null;

  return {
    id: session.user.id!,
    email: session.user.email!,
    name: session.user.name ?? null,
    role: "admin",
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const fetchReq = vercelToFetchRequest(req);

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: fetchReq,
    router: appRouter,
    createContext: async () =>
      createContext({
        getUser: () => getUserFromSession(fetchReq),
        requestId: req.headers["x-request-id"]?.toString() ?? undefined,
        updateImportProgress: () => {},
      }),
    onError({ error, path }) {
      console.error(`tRPC error on ${path}:`, error);
    },
  });

  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const body = await response.text();
  res.send(body);
}
