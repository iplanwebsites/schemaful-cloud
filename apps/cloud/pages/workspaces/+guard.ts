/**
 * Copyright 2025 Schemaful
 *
 * This file is part of Schemaful Cloud Edition.
 * See LICENSE for licensing terms.
 */

import type { GuardAsync } from "vike/types";
import { redirect } from "vike/abort";
import { getSession } from "@schemaful-ee/auth";

/**
 * Build a Request object from Vike's pageContext
 */
function buildRequestFromContext(pageContext: {
  urlOriginal?: string;
  headersOriginal?: Record<string, string | string[] | undefined>;
}): Request | null {
  const { urlOriginal, headersOriginal } = pageContext;

  if (!urlOriginal || !headersOriginal) {
    return null;
  }

  // Get host from headers
  const host = headersOriginal["host"] || headersOriginal["x-forwarded-host"] || "localhost";
  const protocol = headersOriginal["x-forwarded-proto"] || "https";
  const hostStr = Array.isArray(host) ? host[0] : host;
  const protoStr = Array.isArray(protocol) ? protocol[0] : protocol;

  try {
    const url = new URL(urlOriginal, `${protoStr}://${hostStr}`);

    const headers = new Headers();
    for (const [key, value] of Object.entries(headersOriginal)) {
      if (value) {
        if (Array.isArray(value)) {
          value.forEach((v) => headers.append(key, v));
        } else {
          headers.set(key, value);
        }
      }
    }

    return new Request(url.toString(), {
      method: "GET",
      headers,
    });
  } catch {
    return null;
  }
}

/**
 * Guard for the workspaces list page
 * Requires authentication: redirects to signin if not logged in
 */
export const guard: GuardAsync = async (pageContext): Promise<void> => {
  const request = buildRequestFromContext(pageContext as {
    urlOriginal?: string;
    headersOriginal?: Record<string, string | string[] | undefined>;
  });

  if (!request) {
    // Client-side navigation - the page will handle auth checks
    return;
  }

  try {
    const session = await getSession(request);

    if (!session?.user) {
      throw redirect("/auth/signin?callbackUrl=/workspaces");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("redirect")) {
      throw error;
    }

    console.error("Guard error:", error);
    throw redirect("/auth/signin?callbackUrl=/workspaces");
  }
};
