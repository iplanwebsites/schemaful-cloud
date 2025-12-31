/**
 * Copyright 2025 ContentFern
 *
 * This file is part of ContentFern Cloud Edition.
 * See LICENSE for licensing terms.
 */

import type express from "express";

// ============================================================
// Configuration
// ============================================================

export interface ConfigCheck {
  name: string;
  envVars: string[];
  required: boolean;
  description: string;
}

export const configChecks: ConfigCheck[] = [
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
 * Check if configuration is valid
 * @returns Object with canStart boolean and status per config
 */
export function checkConfiguration(env: Record<string, string | undefined> = process.env): {
  canStart: boolean;
  statuses: Array<{
    name: string;
    status: "configured" | "missing" | "partial" | "optional";
    missingVars?: string[];
  }>;
} {
  const statuses: Array<{
    name: string;
    status: "configured" | "missing" | "partial" | "optional";
    missingVars?: string[];
  }> = [];

  let canStart = true;

  for (const check of configChecks) {
    const configured = check.envVars.every((v) => !!env[v]);
    const partial = check.envVars.some((v) => !!env[v]);
    const missingVars = check.envVars.filter((v) => !env[v]);

    if (configured) {
      statuses.push({ name: check.name, status: "configured" });
    } else if (check.required) {
      statuses.push({ name: check.name, status: "missing", missingVars });
      canStart = false;
    } else if (partial) {
      statuses.push({ name: check.name, status: "partial", missingVars });
    } else {
      statuses.push({ name: check.name, status: "optional" });
    }
  }

  return { canStart, statuses };
}

// ============================================================
// Request Conversion
// ============================================================

/**
 * Convert Express request to Fetch Request
 */
export function expressToFetchRequest(req: express.Request): Request {
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

// ============================================================
// Workspace Routing
// ============================================================

/**
 * Extract workspace slug from URL path
 *
 * Pattern: /api/workspaces/:slug/trpc/*
 */
export function extractWorkspaceSlug(path: string): string | null {
  const match = path.match(/^\/api\/workspaces\/([^/]+)\/trpc/);
  return match ? match[1] : null;
}

/**
 * Validate workspace slug format
 * - Must be 3-50 characters
 * - Only lowercase letters, numbers, and hyphens
 * - Must start with a letter
 * - Must not end with a hyphen
 */
export function isValidWorkspaceSlug(slug: string): boolean {
  if (slug.length < 3 || slug.length > 50) return false;
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug)) return false;
  if (slug.includes("--")) return false; // No consecutive hyphens
  return true;
}

// ============================================================
// Stripe Webhook Validation
// ============================================================

/**
 * Parse Stripe webhook signature header
 */
export function parseStripeSignature(header: string): {
  timestamp: number;
  signatures: string[];
} | null {
  try {
    const parts = header.split(",");
    let timestamp = 0;
    const signatures: string[] = [];

    for (const part of parts) {
      const [key, value] = part.split("=");
      if (key === "t") {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) return null;
        timestamp = parsed;
      } else if (key === "v1") {
        signatures.push(value);
      }
    }

    if (timestamp === 0 || signatures.length === 0) {
      return null;
    }

    return { timestamp, signatures };
  } catch {
    return null;
  }
}

/**
 * Check if webhook timestamp is within tolerance (5 minutes)
 */
export function isTimestampValid(
  timestamp: number,
  toleranceSeconds: number = 300
): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - timestamp) <= toleranceSeconds;
}
