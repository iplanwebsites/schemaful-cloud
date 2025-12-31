/**
 * Copyright 2025 ContentFern
 *
 * This file is part of ContentFern Cloud Edition.
 * See LICENSE for licensing terms.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkConfiguration,
  configChecks,
  extractWorkspaceSlug,
  isValidWorkspaceSlug,
  parseStripeSignature,
  isTimestampValid,
} from "../utils.js";

// ============================================================
// Configuration Tests
// ============================================================

describe("checkConfiguration", () => {
  it("returns canStart=false when required config is missing", () => {
    const result = checkConfiguration({});

    expect(result.canStart).toBe(false);
    expect(result.statuses.find((s) => s.name === "Cloud Database")?.status).toBe(
      "missing"
    );
    expect(result.statuses.find((s) => s.name === "Auth.js")?.status).toBe(
      "missing"
    );
  });

  it("returns canStart=true when required config is present", () => {
    const result = checkConfiguration({
      DATABASE_URL: "postgresql://localhost/test",
      AUTH_SECRET: "secret123",
    });

    expect(result.canStart).toBe(true);
    expect(result.statuses.find((s) => s.name === "Cloud Database")?.status).toBe(
      "configured"
    );
    expect(result.statuses.find((s) => s.name === "Auth.js")?.status).toBe(
      "configured"
    );
  });

  it("marks optional config as optional when missing", () => {
    const result = checkConfiguration({
      DATABASE_URL: "postgresql://localhost/test",
      AUTH_SECRET: "secret123",
    });

    expect(result.statuses.find((s) => s.name === "Google OAuth")?.status).toBe(
      "optional"
    );
    expect(result.statuses.find((s) => s.name === "Stripe")?.status).toBe(
      "optional"
    );
    expect(result.statuses.find((s) => s.name === "Neon API")?.status).toBe(
      "optional"
    );
  });

  it("marks partial config correctly", () => {
    const result = checkConfiguration({
      DATABASE_URL: "postgresql://localhost/test",
      AUTH_SECRET: "secret123",
      STRIPE_SECRET_KEY: "sk_test_123",
      // Missing STRIPE_WEBHOOK_SECRET
    });

    const stripeStatus = result.statuses.find((s) => s.name === "Stripe");
    expect(stripeStatus?.status).toBe("partial");
    expect(stripeStatus?.missingVars).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("shows all configured when everything is set", () => {
    const result = checkConfiguration({
      DATABASE_URL: "postgresql://localhost/test",
      AUTH_SECRET: "secret123",
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_123",
      NEON_API_KEY: "neon-key",
    });

    expect(result.canStart).toBe(true);
    expect(result.statuses.every((s) => s.status === "configured")).toBe(true);
  });

  it("includes missing variable names for missing configs", () => {
    const result = checkConfiguration({});

    const dbStatus = result.statuses.find((s) => s.name === "Cloud Database");
    expect(dbStatus?.missingVars).toContain("DATABASE_URL");
  });
});

describe("configChecks", () => {
  it("includes all expected configuration checks", () => {
    const names = configChecks.map((c) => c.name);

    expect(names).toContain("Cloud Database");
    expect(names).toContain("Auth.js");
    expect(names).toContain("Google OAuth");
    expect(names).toContain("Stripe");
    expect(names).toContain("Neon API");
  });

  it("marks DATABASE_URL and AUTH_SECRET as required", () => {
    const requiredChecks = configChecks.filter((c) => c.required);
    const requiredEnvVars = requiredChecks.flatMap((c) => c.envVars);

    expect(requiredEnvVars).toContain("DATABASE_URL");
    expect(requiredEnvVars).toContain("AUTH_SECRET");
  });
});

// ============================================================
// Workspace Routing Tests
// ============================================================

describe("extractWorkspaceSlug", () => {
  it("extracts slug from valid workspace trpc path", () => {
    expect(extractWorkspaceSlug("/api/workspaces/my-workspace/trpc/something")).toBe(
      "my-workspace"
    );
  });

  it("extracts slug from path with just trpc", () => {
    expect(extractWorkspaceSlug("/api/workspaces/acme-corp/trpc")).toBe("acme-corp");
  });

  it("handles slugs with numbers", () => {
    expect(extractWorkspaceSlug("/api/workspaces/workspace123/trpc/query")).toBe(
      "workspace123"
    );
  });

  it("returns null for non-matching paths", () => {
    expect(extractWorkspaceSlug("/api/trpc")).toBeNull();
    expect(extractWorkspaceSlug("/api/workspaces")).toBeNull();
    expect(extractWorkspaceSlug("/workspaces/slug/trpc")).toBeNull();
  });

  it("returns null for empty path", () => {
    expect(extractWorkspaceSlug("")).toBeNull();
  });

  it("returns null for root path", () => {
    expect(extractWorkspaceSlug("/")).toBeNull();
  });
});

describe("isValidWorkspaceSlug", () => {
  describe("valid slugs", () => {
    it("accepts lowercase letters only", () => {
      expect(isValidWorkspaceSlug("myworkspace")).toBe(true);
    });

    it("accepts letters with numbers", () => {
      expect(isValidWorkspaceSlug("workspace123")).toBe(true);
      expect(isValidWorkspaceSlug("my2ndworkspace")).toBe(true);
    });

    it("accepts hyphens in the middle", () => {
      expect(isValidWorkspaceSlug("my-workspace")).toBe(true);
      expect(isValidWorkspaceSlug("my-great-workspace")).toBe(true);
    });

    it("accepts minimum length (3 chars)", () => {
      expect(isValidWorkspaceSlug("abc")).toBe(true);
    });

    it("accepts maximum length (50 chars)", () => {
      const slug = "a" + "b".repeat(48) + "c";
      expect(slug.length).toBe(50);
      expect(isValidWorkspaceSlug(slug)).toBe(true);
    });
  });

  describe("invalid slugs", () => {
    it("rejects too short (< 3 chars)", () => {
      expect(isValidWorkspaceSlug("ab")).toBe(false);
      expect(isValidWorkspaceSlug("a")).toBe(false);
    });

    it("rejects too long (> 50 chars)", () => {
      const slug = "a".repeat(51);
      expect(isValidWorkspaceSlug(slug)).toBe(false);
    });

    it("rejects uppercase letters", () => {
      expect(isValidWorkspaceSlug("MyWorkspace")).toBe(false);
      expect(isValidWorkspaceSlug("WORKSPACE")).toBe(false);
    });

    it("rejects starting with number", () => {
      expect(isValidWorkspaceSlug("1workspace")).toBe(false);
      expect(isValidWorkspaceSlug("123abc")).toBe(false);
    });

    it("rejects starting with hyphen", () => {
      expect(isValidWorkspaceSlug("-workspace")).toBe(false);
    });

    it("rejects ending with hyphen", () => {
      expect(isValidWorkspaceSlug("workspace-")).toBe(false);
    });

    it("rejects consecutive hyphens", () => {
      expect(isValidWorkspaceSlug("my--workspace")).toBe(false);
    });

    it("rejects special characters", () => {
      expect(isValidWorkspaceSlug("my_workspace")).toBe(false);
      expect(isValidWorkspaceSlug("my.workspace")).toBe(false);
      expect(isValidWorkspaceSlug("my@workspace")).toBe(false);
    });

    it("rejects spaces", () => {
      expect(isValidWorkspaceSlug("my workspace")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidWorkspaceSlug("")).toBe(false);
    });
  });
});

// ============================================================
// Stripe Webhook Tests
// ============================================================

describe("parseStripeSignature", () => {
  it("parses valid signature header", () => {
    const header = "t=1234567890,v1=abc123,v1=def456";
    const result = parseStripeSignature(header);

    expect(result).not.toBeNull();
    expect(result?.timestamp).toBe(1234567890);
    expect(result?.signatures).toContain("abc123");
    expect(result?.signatures).toContain("def456");
  });

  it("parses header with single signature", () => {
    const header = "t=1234567890,v1=abc123";
    const result = parseStripeSignature(header);

    expect(result?.timestamp).toBe(1234567890);
    expect(result?.signatures).toHaveLength(1);
    expect(result?.signatures[0]).toBe("abc123");
  });

  it("returns null for missing timestamp", () => {
    const header = "v1=abc123";
    expect(parseStripeSignature(header)).toBeNull();
  });

  it("returns null for missing signature", () => {
    const header = "t=1234567890";
    expect(parseStripeSignature(header)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseStripeSignature("")).toBeNull();
  });

  it("returns null for malformed header", () => {
    expect(parseStripeSignature("invalid")).toBeNull();
    expect(parseStripeSignature("t=abc,v1=def")).toBeNull(); // NaN timestamp
  });

  it("ignores unknown keys", () => {
    const header = "t=1234567890,v1=abc123,unknown=value";
    const result = parseStripeSignature(header);

    expect(result?.signatures).toHaveLength(1);
  });
});

describe("isTimestampValid", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for current timestamp", () => {
    const now = Math.floor(Date.now() / 1000);
    vi.setSystemTime(now * 1000);

    expect(isTimestampValid(now)).toBe(true);
  });

  it("returns true for timestamp within tolerance", () => {
    const now = 1700000000;
    vi.setSystemTime(now * 1000);

    // 4 minutes ago (within 5 minute tolerance)
    expect(isTimestampValid(now - 240)).toBe(true);

    // 4 minutes in future
    expect(isTimestampValid(now + 240)).toBe(true);
  });

  it("returns false for timestamp outside tolerance", () => {
    const now = 1700000000;
    vi.setSystemTime(now * 1000);

    // 6 minutes ago (outside 5 minute tolerance)
    expect(isTimestampValid(now - 360)).toBe(false);

    // 6 minutes in future
    expect(isTimestampValid(now + 360)).toBe(false);
  });

  it("accepts custom tolerance", () => {
    const now = 1700000000;
    vi.setSystemTime(now * 1000);

    // 30 seconds ago with 60 second tolerance
    expect(isTimestampValid(now - 30, 60)).toBe(true);

    // 90 seconds ago with 60 second tolerance
    expect(isTimestampValid(now - 90, 60)).toBe(false);
  });

  it("returns true for exactly at tolerance boundary", () => {
    const now = 1700000000;
    vi.setSystemTime(now * 1000);

    expect(isTimestampValid(now - 300, 300)).toBe(true);
    expect(isTimestampValid(now + 300, 300)).toBe(true);
  });
});
