/**
 * Copyright 2025 Schemaful
 *
 * This file is part of Schemaful Cloud Edition.
 * See LICENSE for licensing terms.
 */

import { useState, useEffect } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@schemaful/ui";
import { Cloud, Plus, Loader2, Users, Settings, LayoutGrid } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
  createdAt: string;
}

// ============================================================================
// Component
// ============================================================================

export default function Page() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchWorkspaces() {
      try {
        const response = await fetch("/api/workspaces", {
          credentials: "include",
        });

        if (!response.ok) {
          if (response.status === 401) {
            // Redirect to signin if not authenticated
            window.location.href = "/auth/signin";
            return;
          }
          throw new Error("Failed to fetch workspaces");
        }

        const data = await response.json();
        setWorkspaces(data.workspaces || []);
      } catch (err) {
        console.error("Error fetching workspaces:", err);
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
      }
    }

    fetchWorkspaces();
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/50">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading workspaces...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-destructive">Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => window.location.reload()}>Try Again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Empty state - redirect to create workspace
  if (workspaces.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
              <Cloud className="h-7 w-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl">Welcome to Schemaful Cloud</CardTitle>
            <CardDescription>
              Create your first workspace to get started building with Schemaful
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button asChild size="lg" className="gap-2">
              <a href="/workspaces/new">
                <Plus className="h-4 w-4" />
                Create your first workspace
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Workspaces list
  return (
    <div className="min-h-screen bg-muted/50">
      {/* Header */}
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Cloud className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold">Schemaful Cloud</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" asChild>
              <a href="/settings">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </a>
            </Button>
            <Button size="sm" asChild>
              <a href="/workspaces/new">
                <Plus className="mr-2 h-4 w-4" />
                New Workspace
              </a>
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Workspaces</h1>
          <p className="text-muted-foreground">
            Manage your workspaces and content
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => (
            <a
              key={workspace.id}
              href={`/workspaces/${workspace.slug}`}
              className="group block"
            >
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <LayoutGrid className="h-5 w-5" />
                    </div>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                      {workspace.role}
                    </span>
                  </div>
                  <CardTitle className="mt-3 group-hover:text-primary">
                    {workspace.name}
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">
                    /{workspace.slug}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      Team
                    </span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs capitalize text-primary">
                      {workspace.plan}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </a>
          ))}

          {/* Add workspace card */}
          <a href="/workspaces/new" className="group block">
            <Card className="flex h-full min-h-[180px] cursor-pointer items-center justify-center border-dashed transition-colors hover:border-primary/50 hover:bg-muted/50">
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                  <Plus className="h-5 w-5" />
                </div>
                <p className="font-medium text-muted-foreground group-hover:text-foreground">
                  Create workspace
                </p>
              </div>
            </Card>
          </a>
        </div>
      </main>
    </div>
  );
}
