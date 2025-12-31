/**
 * Copyright 2025 Schemaful
 *
 * Vercel API route for user signup
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, cloudUsers } from "@schemaful-ee/auth";

/**
 * Signup request validation schema
 */
const signupSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name too long"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

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
    // This approach is simpler and more secure than trying to create a session manually
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
}
