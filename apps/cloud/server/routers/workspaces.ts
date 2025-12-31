/**
 * Copyright 2025 Schemaful
 *
 * This file is part of Schemaful Cloud Edition.
 * See LICENSE for licensing terms.
 */

/**
 * Workspaces Router
 *
 * tRPC router for workspace management in Schemaful Cloud.
 * Handles CRUD operations for workspaces, including:
 * - Creating workspaces with Neon database provisioning
 * - Managing workspace members and roles
 * - Optional Stripe customer creation for billing
 * - Cleanup on workspace deletion
 */

import { z } from "zod";
import { initTRPC, TRPCError } from "@trpc/server";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, count } from "drizzle-orm";
import {
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  subscriptions,
  cloudUsers,
  type MemberRole,
} from "@schemaful-ee/auth";
import {
  provisionDatabase,
  deleteDatabase,
  getDatabaseStats,
} from "@schemaful-ee/provisioning";
import { createCustomer } from "@schemaful-ee/billing";
import { slugify } from "@schemaful/shared";

// ============================================================================
// Types
// ============================================================================

interface CloudUser {
  id: string;
  email: string;
  name: string | null;
  isSuperAdmin?: boolean;
}

interface WorkspaceContext {
  user: CloudUser;
}

// ============================================================================
// tRPC Setup
// ============================================================================

const t = initTRPC.context<WorkspaceContext>().create();

/**
 * Get cloud database connection
 */
function getCloudDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  const sqlClient = neon(databaseUrl);
  return drizzle(sqlClient);
}

/**
 * Authentication middleware - ensures user is logged in
 */
const isAuthenticated = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to perform this action",
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/**
 * Protected procedure - requires authentication
 */
const protectedProc = t.procedure.use(isAuthenticated);

/**
 * Get workspace membership for the current user
 */
async function getWorkspaceMembership(
  db: ReturnType<typeof getCloudDb>,
  workspaceId: string,
  userId: string
) {
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  return membership;
}

/**
 * Check if a role has admin or owner privileges
 */
function isAdminOrOwner(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Check if a role is owner
 */
function isOwner(role: MemberRole): boolean {
  return role === "owner";
}

/**
 * Generate a unique slug from a name
 * Appends a random suffix if the slug is already taken
 */
async function generateUniqueSlug(
  db: ReturnType<typeof getCloudDb>,
  name: string
): Promise<string> {
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const [existing] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);

    if (!existing) {
      return slug;
    }

    // Add random suffix for uniqueness
    const suffix = Math.random().toString(36).substring(2, 6);
    slug = `${baseSlug}-${suffix}`;
    attempts++;
  }

  throw new Error("Could not generate a unique slug after multiple attempts");
}

// ============================================================================
// Workspaces Router
// ============================================================================

export const workspacesRouter = t.router({
  // ==========================================================================
  // create - Create a new workspace with database provisioning
  // ==========================================================================
  create: protectedProc
    .input(
      z.object({
        name: z.string().min(1).max(255),
        slug: z
          .string()
          .min(1)
          .max(100)
          .regex(
            /^[a-z0-9-]+$/,
            "Slug must be lowercase alphanumeric with hyphens only"
          )
          .optional(),
        createStripeCustomer: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getCloudDb();

      // Generate slug from name if not provided
      const slug = input.slug
        ? input.slug
        : await generateUniqueSlug(db, input.name);

      // Check if slug is already taken
      const [existing] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, slug))
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Workspace slug is already taken",
        });
      }

      // Provision Neon database
      const provisionResult = await provisionDatabase(slug);

      if (!provisionResult.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to provision database: ${provisionResult.error}`,
        });
      }

      // Generate workspace ID
      const workspaceId = crypto.randomUUID();

      // Optionally create Stripe customer
      let stripeCustomerId: string | undefined;
      if (input.createStripeCustomer && ctx.user.email) {
        try {
          stripeCustomerId = await createCustomer({
            email: ctx.user.email,
            workspaceId,
            name: input.name,
          });
        } catch (error) {
          // Log but don't fail workspace creation if Stripe fails
          console.error("Failed to create Stripe customer:", error);
        }
      }

      // Create workspace record
      const now = new Date();
      await db.insert(workspaces).values({
        id: workspaceId,
        name: input.name,
        slug,
        plan: "free",
        neonProjectId: provisionResult.projectId!,
        databaseUrl: provisionResult.connectionString!,
        poolerUrl: provisionResult.poolerConnectionString,
        stripeCustomerId,
        settings: {},
        isSuspended: false,
        createdAt: now,
        updatedAt: now,
      });

      // Create owner membership for the current user
      await db.insert(workspaceMembers).values({
        workspaceId,
        userId: ctx.user.id,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      });

      // Return the created workspace
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);

      return {
        ...workspace,
        role: "owner" as const,
      };
    }),

  // ==========================================================================
  // list - List all workspaces the current user is a member of
  // ==========================================================================
  list: protectedProc.query(async ({ ctx }) => {
    const db = getCloudDb();

    // Get all workspaces the user is a member of
    const memberships = await db
      .select({
        workspace: workspaces,
        role: workspaceMembers.role,
        memberCount: count(workspaceMembers.userId).as("memberCount"),
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, ctx.user.id))
      .groupBy(workspaces.id, workspaceMembers.role);

    // Get member counts for each workspace
    const workspaceIds = memberships.map((m) => m.workspace.id);

    // Fetch member counts separately since groupBy doesn't work well with joins
    const memberCounts = await Promise.all(
      workspaceIds.map(async (workspaceId) => {
        const [result] = await db
          .select({ count: count() })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, workspaceId));
        return { workspaceId, count: result.count };
      })
    );

    const countMap = new Map(memberCounts.map((c) => [c.workspaceId, c.count]));

    return memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
      memberCount: countMap.get(m.workspace.id) ?? 0,
    }));
  }),

  // ==========================================================================
  // get - Get a workspace by slug or ID
  // ==========================================================================
  get: protectedProc
    .input(
      z.object({
        slug: z.string().optional(),
        id: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!input.slug && !input.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either slug or id is required",
        });
      }

      const db = getCloudDb();

      // Get workspace
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(
          input.id ? eq(workspaces.id, input.id) : eq(workspaces.slug, input.slug!)
        )
        .limit(1);

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Check if user is a member
      const membership = await getWorkspaceMembership(
        db,
        workspace.id,
        ctx.user.id
      );

      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this workspace",
        });
      }

      // Get members
      const members = await db
        .select({
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
          createdAt: workspaceMembers.createdAt,
          user: {
            id: cloudUsers.id,
            name: cloudUsers.name,
            email: cloudUsers.email,
            image: cloudUsers.image,
          },
        })
        .from(workspaceMembers)
        .innerJoin(cloudUsers, eq(cloudUsers.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, workspace.id));

      // Get subscription status if exists
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.workspaceId, workspace.id))
        .limit(1);

      return {
        ...workspace,
        role: membership.role,
        members,
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              currentPeriodStart: subscription.currentPeriodStart,
              currentPeriodEnd: subscription.currentPeriodEnd,
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            }
          : null,
        memberCount: members.length,
      };
    }),

  // ==========================================================================
  // update - Update a workspace (admin or owner only)
  // ==========================================================================
  update: protectedProc
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
        settings: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getCloudDb();

      // Check workspace exists
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, input.id))
        .limit(1);

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Check user is admin or owner
      const membership = await getWorkspaceMembership(
        db,
        workspace.id,
        ctx.user.id
      );

      if (!membership || !isAdminOrOwner(membership.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You must be an admin or owner to update this workspace",
        });
      }

      // Build update object
      const updates: Partial<typeof workspaces.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name) {
        updates.name = input.name;
      }

      if (input.settings) {
        // Merge settings with existing
        updates.settings = {
          ...(workspace.settings as object),
          ...input.settings,
        };
      }

      // Update workspace
      await db
        .update(workspaces)
        .set(updates)
        .where(eq(workspaces.id, input.id));

      // Return updated workspace
      const [updated] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, input.id))
        .limit(1);

      return {
        ...updated,
        role: membership.role,
      };
    }),

  // ==========================================================================
  // delete - Delete a workspace (owner only)
  // ==========================================================================
  delete: protectedProc
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getCloudDb();

      // Get workspace
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, input.id))
        .limit(1);

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Check user is owner
      const membership = await getWorkspaceMembership(
        db,
        workspace.id,
        ctx.user.id
      );

      if (!membership || !isOwner(membership.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the workspace owner can delete it",
        });
      }

      // Delete Neon project if exists
      if (workspace.neonProjectId) {
        const deleteResult = await deleteDatabase(workspace.neonProjectId);
        if (!deleteResult.success) {
          console.error(
            `Failed to delete Neon project ${workspace.neonProjectId}:`,
            deleteResult.error
          );
          // Don't fail the workspace deletion if Neon cleanup fails
          // The project may have already been deleted or the API may be unavailable
        }
      }

      // Delete invitations (cascade should handle this, but be explicit)
      await db
        .delete(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, input.id));

      // Delete members (cascade should handle this, but be explicit)
      await db
        .delete(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, input.id));

      // Delete workspace (this will cascade to subscriptions and usage records)
      await db.delete(workspaces).where(eq(workspaces.id, input.id));

      return { success: true };
    }),

  // ==========================================================================
  // getStats - Get database stats for a workspace (admin only)
  // ==========================================================================
  getStats: protectedProc
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = getCloudDb();

      // Get workspace
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, input.id))
        .limit(1);

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Check user is a member
      const membership = await getWorkspaceMembership(
        db,
        workspace.id,
        ctx.user.id
      );

      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this workspace",
        });
      }

      if (!workspace.neonProjectId) {
        return null;
      }

      return getDatabaseStats(workspace.neonProjectId);
    }),

  // ==========================================================================
  // Members sub-router
  // ==========================================================================
  members: t.router({
    /**
     * List workspace members
     */
    list: protectedProc
      .input(z.object({ workspaceId: z.string() }))
      .query(async ({ ctx, input }) => {
        const db = getCloudDb();

        // Check user is a member
        const membership = await getWorkspaceMembership(
          db,
          input.workspaceId,
          ctx.user.id
        );

        if (!membership) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this workspace",
          });
        }

        const members = await db
          .select({
            userId: workspaceMembers.userId,
            role: workspaceMembers.role,
            createdAt: workspaceMembers.createdAt,
            user: {
              id: cloudUsers.id,
              name: cloudUsers.name,
              email: cloudUsers.email,
              image: cloudUsers.image,
            },
          })
          .from(workspaceMembers)
          .innerJoin(cloudUsers, eq(cloudUsers.id, workspaceMembers.userId))
          .where(eq(workspaceMembers.workspaceId, input.workspaceId));

        return members;
      }),

    /**
     * Update member role (admin/owner only)
     */
    updateRole: protectedProc
      .input(
        z.object({
          workspaceId: z.string(),
          userId: z.string(),
          role: z.enum(["admin", "editor", "viewer"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = getCloudDb();

        // Check current user is admin or owner
        const currentMembership = await getWorkspaceMembership(
          db,
          input.workspaceId,
          ctx.user.id
        );

        if (!currentMembership || !isAdminOrOwner(currentMembership.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins or owners can change member roles",
          });
        }

        // Can't change your own role
        if (input.userId === ctx.user.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You cannot change your own role",
          });
        }

        // Get target member
        const targetMembership = await getWorkspaceMembership(
          db,
          input.workspaceId,
          input.userId
        );

        if (!targetMembership) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member not found",
          });
        }

        // Can't change owner's role
        if (isOwner(targetMembership.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot change the owner's role",
          });
        }

        // Admins can't promote to admin (only owner can)
        if (currentMembership.role === "admin" && input.role === "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only owners can promote members to admin",
          });
        }

        await db
          .update(workspaceMembers)
          .set({
            role: input.role,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.userId)
            )
          );

        return { success: true };
      }),

    /**
     * Remove a member (admin/owner only)
     */
    remove: protectedProc
      .input(
        z.object({
          workspaceId: z.string(),
          userId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = getCloudDb();

        // Check current user is admin or owner
        const currentMembership = await getWorkspaceMembership(
          db,
          input.workspaceId,
          ctx.user.id
        );

        if (!currentMembership || !isAdminOrOwner(currentMembership.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins or owners can remove members",
          });
        }

        // Can't remove yourself
        if (input.userId === ctx.user.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You cannot remove yourself. Transfer ownership first.",
          });
        }

        // Get target member
        const targetMembership = await getWorkspaceMembership(
          db,
          input.workspaceId,
          input.userId
        );

        if (!targetMembership) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member not found",
          });
        }

        // Can't remove owner
        if (isOwner(targetMembership.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot remove the workspace owner",
          });
        }

        // Admins can only remove editors/viewers, not other admins
        if (
          currentMembership.role === "admin" &&
          targetMembership.role === "admin"
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Admins cannot remove other admins",
          });
        }

        await db
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.userId)
            )
          );

        return { success: true };
      }),

    /**
     * Leave workspace (any member except owner)
     */
    leave: protectedProc
      .input(z.object({ workspaceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const db = getCloudDb();

        const membership = await getWorkspaceMembership(
          db,
          input.workspaceId,
          ctx.user.id
        );

        if (!membership) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not a member of this workspace",
          });
        }

        if (isOwner(membership.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Owners cannot leave the workspace. Transfer ownership or delete the workspace instead.",
          });
        }

        await db
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, ctx.user.id)
            )
          );

        return { success: true };
      }),
  }),

  // ==========================================================================
  // Invitations sub-router
  // ==========================================================================
  invitations: t.router({
    /**
     * List pending invitations (admin/owner only)
     */
    list: protectedProc
      .input(z.object({ workspaceId: z.string() }))
      .query(async ({ ctx, input }) => {
        const db = getCloudDb();

        const membership = await getWorkspaceMembership(
          db,
          input.workspaceId,
          ctx.user.id
        );

        if (!membership || !isAdminOrOwner(membership.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins or owners can view invitations",
          });
        }

        const invitations = await db
          .select({
            id: workspaceInvitations.id,
            email: workspaceInvitations.email,
            role: workspaceInvitations.role,
            token: workspaceInvitations.token,
            expiresAt: workspaceInvitations.expiresAt,
            acceptedAt: workspaceInvitations.acceptedAt,
            createdAt: workspaceInvitations.createdAt,
            invitedBy: {
              id: cloudUsers.id,
              name: cloudUsers.name,
              email: cloudUsers.email,
            },
          })
          .from(workspaceInvitations)
          .innerJoin(cloudUsers, eq(cloudUsers.id, workspaceInvitations.invitedBy))
          .where(eq(workspaceInvitations.workspaceId, input.workspaceId));

        return invitations;
      }),

    /**
     * Create invitation (admin/owner only)
     */
    create: protectedProc
      .input(
        z.object({
          workspaceId: z.string(),
          email: z.string().email(),
          role: z.enum(["admin", "editor", "viewer"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = getCloudDb();

        const membership = await getWorkspaceMembership(
          db,
          input.workspaceId,
          ctx.user.id
        );

        if (!membership || !isAdminOrOwner(membership.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins or owners can create invitations",
          });
        }

        // Admins can't invite admins (only owners can)
        if (membership.role === "admin" && input.role === "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only owners can invite admins",
          });
        }

        // Check if user is already a member
        const [existingUser] = await db
          .select({ id: cloudUsers.id })
          .from(cloudUsers)
          .where(eq(cloudUsers.email, input.email.toLowerCase()))
          .limit(1);

        if (existingUser) {
          const existingMembership = await getWorkspaceMembership(
            db,
            input.workspaceId,
            existingUser.id
          );

          if (existingMembership) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "User is already a member of this workspace",
            });
          }
        }

        // Check for pending invitation
        const [existingInvite] = await db
          .select({ id: workspaceInvitations.id })
          .from(workspaceInvitations)
          .where(
            and(
              eq(workspaceInvitations.workspaceId, input.workspaceId),
              eq(workspaceInvitations.email, input.email.toLowerCase())
            )
          )
          .limit(1);

        if (existingInvite) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An invitation has already been sent to this email",
          });
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
        const token = crypto.randomUUID();

        const [invitation] = await db
          .insert(workspaceInvitations)
          .values({
            id: crypto.randomUUID(),
            workspaceId: input.workspaceId,
            email: input.email.toLowerCase(),
            role: input.role,
            token,
            invitedBy: ctx.user.id,
            expiresAt,
            createdAt: now,
          })
          .returning();

        // TODO: Send invitation email

        return invitation;
      }),

    /**
     * Revoke invitation (admin/owner only)
     */
    revoke: protectedProc
      .input(
        z.object({
          workspaceId: z.string(),
          invitationId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = getCloudDb();

        const membership = await getWorkspaceMembership(
          db,
          input.workspaceId,
          ctx.user.id
        );

        if (!membership || !isAdminOrOwner(membership.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins or owners can revoke invitations",
          });
        }

        const [invitation] = await db
          .select()
          .from(workspaceInvitations)
          .where(
            and(
              eq(workspaceInvitations.id, input.invitationId),
              eq(workspaceInvitations.workspaceId, input.workspaceId)
            )
          )
          .limit(1);

        if (!invitation) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invitation not found",
          });
        }

        await db
          .delete(workspaceInvitations)
          .where(eq(workspaceInvitations.id, input.invitationId));

        return { success: true };
      }),

    /**
     * Accept invitation (authenticated user)
     */
    accept: protectedProc
      .input(z.object({ token: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const db = getCloudDb();

        const [invitation] = await db
          .select()
          .from(workspaceInvitations)
          .where(eq(workspaceInvitations.token, input.token))
          .limit(1);

        if (!invitation) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invitation not found",
          });
        }

        // Check if invitation has expired
        if (invitation.expiresAt < new Date()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invitation has expired",
          });
        }

        // Check if invitation has already been accepted
        if (invitation.acceptedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invitation has already been accepted",
          });
        }

        // Check if email matches
        if (invitation.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "This invitation was sent to a different email address",
          });
        }

        // Check if user is already a member
        const existingMembership = await getWorkspaceMembership(
          db,
          invitation.workspaceId,
          ctx.user.id
        );

        if (existingMembership) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "You are already a member of this workspace",
          });
        }

        const now = new Date();

        // Create membership
        await db.insert(workspaceMembers).values({
          workspaceId: invitation.workspaceId,
          userId: ctx.user.id,
          role: invitation.role,
          createdAt: now,
          updatedAt: now,
        });

        // Mark invitation as accepted
        await db
          .update(workspaceInvitations)
          .set({ acceptedAt: now })
          .where(eq(workspaceInvitations.id, invitation.id));

        // Get workspace for return
        const [workspace] = await db
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, invitation.workspaceId))
          .limit(1);

        return {
          success: true,
          workspace: workspace
            ? { id: workspace.id, slug: workspace.slug, name: workspace.name }
            : null,
        };
      }),

    /**
     * Get invitation by token (public - for showing invitation details before accepting)
     */
    getByToken: t.procedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const db = getCloudDb();

        const [invitation] = await db
          .select({
            id: workspaceInvitations.id,
            email: workspaceInvitations.email,
            role: workspaceInvitations.role,
            expiresAt: workspaceInvitations.expiresAt,
            acceptedAt: workspaceInvitations.acceptedAt,
            workspace: {
              id: workspaces.id,
              name: workspaces.name,
              slug: workspaces.slug,
            },
          })
          .from(workspaceInvitations)
          .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
          .where(eq(workspaceInvitations.token, input.token))
          .limit(1);

        if (!invitation) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invitation not found",
          });
        }

        return invitation;
      }),
  }),
});

export type WorkspacesRouter = typeof workspacesRouter;
