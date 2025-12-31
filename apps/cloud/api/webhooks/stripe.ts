/**
 * Copyright 2025 Schemaful
 *
 * Vercel API route for Stripe webhooks
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createWebhookHandler } from "@schemaful-ee/billing";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

function getCloudDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return drizzle(sql);
}

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      return res.status(400).json({ error: "Missing stripe-signature header" });
    }

    const rawBody = await getRawBody(req);
    const db = getCloudDb();
    const handler = createWebhookHandler(db as any);
    const result = await handler(rawBody, signature);

    if (result.success) {
      res.json({ received: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error("Stripe webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}
