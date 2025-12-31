/**
 * Copyright 2025 Schemaful
 *
 * Vercel Serverless Function for Vike SSR
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up import map for Vike to find the built server files
process.env.VITE_SERVER_ENTRY = path.resolve(__dirname, "../dist/server/index.js");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Import Vike's renderPage function from the built server bundle
    const { renderPage } = await import("vike/server");

    // Build headers object for Vike
    const headersOriginal: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headersOriginal[key] = value;
      }
    }

    // Render the page
    const pageContext = await renderPage({
      urlOriginal: req.url!,
      headersOriginal,
    });

    const { httpResponse } = pageContext;

    // Handle 404s or pages that don't match
    if (!httpResponse) {
      res.status(404).send("Page not found");
      return;
    }

    const { statusCode, headers, body } = httpResponse;

    // Set response status
    res.status(statusCode);

    // Set response headers
    for (const [name, value] of headers) {
      res.setHeader(name, value);
    }

    // Send the response body
    res.send(body);
  } catch (error) {
    console.error("SSR Error:", error);
    res.status(500).send("Internal Server Error");
  }
}
