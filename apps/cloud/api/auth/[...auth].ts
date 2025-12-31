/**
 * Copyright 2025 Schemaful
 *
 * Vercel API route for Auth.js
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleAuth } from "@schemaful-ee/auth";

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
  try {
    const fetchReq = vercelToFetchRequest(req);
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
}
