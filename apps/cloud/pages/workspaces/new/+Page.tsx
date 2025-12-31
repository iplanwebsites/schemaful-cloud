/**
 * Copyright 2025 Schemaful
 *
 * This file is part of Schemaful Cloud Edition.
 * See LICENSE for licensing terms.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Progress,
} from "@schemaful/ui";
import { Cloud, Check, AlertCircle, Loader2 } from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface ProvisioningStep {
  id: string;
  label: string;
  description: string;
}

type ProvisioningStatus = "idle" | "creating" | "provisioning" | "finalizing" | "complete" | "error";

interface SlugValidation {
  isValid: boolean;
  message: string;
}

// ============================================================================
// Constants
// ============================================================================

const PROVISIONING_STEPS: ProvisioningStep[] = [
  { id: "creating", label: "Creating workspace", description: "Setting up your workspace..." },
  { id: "provisioning", label: "Provisioning database", description: "Creating your dedicated database..." },
  { id: "finalizing", label: "Almost there", description: "Finalizing configuration..." },
];

const SLUG_MIN_LENGTH = 3;
const SLUG_MAX_LENGTH = 50;
const SLUG_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a URL-friendly slug from a name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special chars
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens
}

/**
 * Validate a workspace slug
 */
function validateSlug(slug: string): SlugValidation {
  if (!slug) {
    return { isValid: false, message: "Slug is required" };
  }

  if (slug.length < SLUG_MIN_LENGTH) {
    return { isValid: false, message: `Slug must be at least ${SLUG_MIN_LENGTH} characters` };
  }

  if (slug.length > SLUG_MAX_LENGTH) {
    return { isValid: false, message: `Slug must be at most ${SLUG_MAX_LENGTH} characters` };
  }

  if (!/^[a-z]/.test(slug)) {
    return { isValid: false, message: "Slug must start with a letter" };
  }

  if (!/[a-z0-9]$/.test(slug)) {
    return { isValid: false, message: "Slug must end with a letter or number" };
  }

  if (/--/.test(slug)) {
    return { isValid: false, message: "Slug cannot contain consecutive hyphens" };
  }

  if (!SLUG_PATTERN.test(slug) && slug.length >= SLUG_MIN_LENGTH) {
    return { isValid: false, message: "Slug can only contain lowercase letters, numbers, and hyphens" };
  }

  return { isValid: true, message: "" };
}

/**
 * Get progress percentage based on provisioning status
 */
function getProgressPercentage(status: ProvisioningStatus): number {
  switch (status) {
    case "idle":
      return 0;
    case "creating":
      return 25;
    case "provisioning":
      return 60;
    case "finalizing":
      return 90;
    case "complete":
      return 100;
    case "error":
      return 0;
    default:
      return 0;
  }
}

// ============================================================================
// Component
// ============================================================================

export default function Page() {
  // Form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  // Provisioning state
  const [status, setStatus] = useState<ProvisioningStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Derive slug from name if user hasn't manually edited it
  useEffect(() => {
    if (!slugTouched && name) {
      setSlug(generateSlug(name));
    }
  }, [name, slugTouched]);

  // Validate slug
  const slugValidation = useMemo(() => validateSlug(slug), [slug]);

  // Check if form is valid
  const isFormValid = useMemo(() => {
    return name.trim().length > 0 && slugValidation.isValid;
  }, [name, slugValidation.isValid]);

  // Handle slug input change
  const handleSlugChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setSlug(value);
    setSlugTouched(true);
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!isFormValid) return;

      setError(null);
      setStatus("creating");

      try {
        // Step 1: Create workspace
        const response = await fetch("/api/workspaces", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: name.trim(),
            slug: slug,
          }),
        });

        if (!response.ok) {
          const data = await response.json();

          if (response.status === 409) {
            setError("This workspace URL is already taken. Please choose a different one.");
            setStatus("error");
            return;
          }

          throw new Error(data.error || "Failed to create workspace");
        }

        // Step 2: Provisioning database (simulated progress)
        setStatus("provisioning");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Step 3: Finalizing
        setStatus("finalizing");
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Step 4: Complete
        setStatus("complete");

        // Redirect to the new workspace
        const data = await response.json();
        await new Promise((resolve) => setTimeout(resolve, 500));
        window.location.href = data.redirectUrl || `/workspaces/${slug}`;
      } catch (err) {
        console.error("Error creating workspace:", err);
        setError(err instanceof Error ? err.message : "An unexpected error occurred");
        setStatus("error");
      }
    },
    [isFormValid, name, slug]
  );

  // Render provisioning UI
  if (status !== "idle" && status !== "error") {
    const progressPercentage = getProgressPercentage(status);
    const currentStepIndex = PROVISIONING_STEPS.findIndex((step) => step.id === status);
    const currentStep = PROVISIONING_STEPS[currentStepIndex] || PROVISIONING_STEPS[PROVISIONING_STEPS.length - 1];

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
              {status === "complete" ? (
                <Check className="h-7 w-7 text-primary-foreground" />
              ) : (
                <Loader2 className="h-7 w-7 animate-spin text-primary-foreground" />
              )}
            </div>
            <CardTitle className="text-2xl">
              {status === "complete" ? "Workspace created!" : "Creating your workspace"}
            </CardTitle>
            <CardDescription>
              {status === "complete"
                ? "Redirecting you to your new workspace..."
                : currentStep.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Progress bar */}
            <div className="space-y-2">
              <Progress value={progressPercentage} className="h-2" />
              <p className="text-center text-sm text-muted-foreground">
                {progressPercentage}% complete
              </p>
            </div>

            {/* Steps indicator */}
            <div className="space-y-3">
              {PROVISIONING_STEPS.map((step, index) => {
                const stepStatus =
                  index < currentStepIndex
                    ? "complete"
                    : index === currentStepIndex
                      ? "active"
                      : "pending";

                return (
                  <div
                    key={step.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                      stepStatus === "active"
                        ? "border-primary bg-primary/5"
                        : stepStatus === "complete"
                          ? "border-green-500/50 bg-green-500/5"
                          : "border-border bg-muted/50"
                    }`}
                  >
                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                        stepStatus === "complete"
                          ? "bg-green-500 text-white"
                          : stepStatus === "active"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {stepStatus === "complete" ? (
                        <Check className="h-3 w-3" />
                      ) : stepStatus === "active" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        index + 1
                      )}
                    </div>
                    <span
                      className={`text-sm ${
                        stepStatus === "pending" ? "text-muted-foreground" : ""
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Workspace info */}
            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <p className="text-sm text-muted-foreground">Your workspace URL</p>
              <p className="mt-1 font-mono text-sm">
                app.schemaful.com/<span className="font-semibold text-primary">{slug}</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render form UI
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
            <Cloud className="h-7 w-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Create your workspace</CardTitle>
          <CardDescription>
            Set up your first workspace to start building with Schemaful
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Error message */}
          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">Something went wrong</p>
                <p className="mt-1 text-sm text-destructive/90">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Workspace name */}
            <div className="space-y-2">
              <Label htmlFor="name">Workspace name</Label>
              <Input
                id="name"
                type="text"
                placeholder="My Workspace"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                This is the display name for your workspace
              </p>
            </div>

            {/* Workspace slug */}
            <div className="space-y-2">
              <Label htmlFor="slug">Workspace URL</Label>
              <div className="flex items-center gap-0">
                <span className="flex h-9 items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                  app.schemaful.com/
                </span>
                <Input
                  id="slug"
                  type="text"
                  placeholder="my-workspace"
                  value={slug}
                  onChange={handleSlugChange}
                  className="rounded-l-none"
                  required
                />
              </div>
              {slug && !slugValidation.isValid && (
                <p className="text-xs text-destructive">{slugValidation.message}</p>
              )}
              {slug && slugValidation.isValid && (
                <p className="flex items-center gap-1 text-xs text-green-600">
                  <Check className="h-3 w-3" />
                  URL looks good!
                </p>
              )}
              {!slug && (
                <p className="text-xs text-muted-foreground">
                  3-50 characters, lowercase letters, numbers, and hyphens only
                </p>
              )}
            </div>

            {/* URL Preview */}
            {slug && slugValidation.isValid && (
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Your workspace will be at
                </p>
                <p className="mt-1 font-mono text-sm">
                  app.schemaful.com/<span className="font-semibold text-primary">{slug}</span>
                </p>
              </div>
            )}

            {/* Submit button */}
            <Button type="submit" className="w-full" size="lg" disabled={!isFormValid}>
              Create Workspace
            </Button>
          </form>

          {/* Info text */}
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Your workspace includes a dedicated database, API keys, and team management.
            You can always create more workspaces later.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
