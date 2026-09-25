#!/usr/bin/env node
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const SERVER_VERSION = "1.0.0";
const HTML_MAX_BYTES = 200_000;

const htmlContentSchema = z.string().min(1).max(HTML_MAX_BYTES);

const issueSchema = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
});

const localReadOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function result<T extends object>(
  structuredContent: T,
  content: string,
  isError = false,
): CallToolResult {
  return {
    structuredContent: structuredContent as Record<string, unknown>,
    content: [{ type: "text", text: content }],
    ...(isError ? { isError: true } : {}),
  };
}

function firstMatch(html: string, pattern: RegExp): string | undefined {
  const match = html.match(pattern);
  const value = match?.[1]?.trim();
  return value ? value : undefined;
}

export function auditSeoMetadata(html: string) {
  const issues: Array<{ code: string; severity: "error" | "warning" | "info"; message: string }> = [];
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = firstMatch(
    html,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
  ) ?? firstMatch(
    html,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i,
  );
  const h1Count = (html.match(/<h1\b/gi) ?? []).length;
  const images = [...html.matchAll(/<img\b([^>]*)>/gi)];

  if (!title) {
    issues.push({ code: "missing-title", severity: "error", message: "Document is missing a <title>." });
  } else if (title.length > 60) {
    issues.push({ code: "long-title", severity: "warning", message: `Title is ${title.length} characters (prefer 60 or fewer).` });
  }

  if (!description) {
    issues.push({ code: "missing-description", severity: "warning", message: "Document is missing a meta description." });
  }

  if (h1Count === 0) {
    issues.push({ code: "missing-h1", severity: "warning", message: "Document has no <h1> heading." });
  } else if (h1Count > 1) {
    issues.push({ code: "multiple-h1", severity: "info", message: `Document has ${h1Count} <h1> headings.` });
  }

  for (const [, attrs] of images) {
    if (!/\balt\s*=/i.test(attrs)) {
      issues.push({ code: "img-missing-alt", severity: "warning", message: "An <img> is missing an alt attribute." });
    }
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return { issues, totalIssues: issues.length, counts };
}

export function validateSchemaMarkup(html: string) {
  const issues: Array<{ code: string; severity: "error" | "warning" | "info"; message: string }> = [];
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  if (blocks.length === 0) {
    issues.push({ code: "no-json-ld", severity: "info", message: "No JSON-LD script blocks found." });
  }

  blocks.forEach((match, index) => {
    const raw = match[1]?.trim() ?? "";
    if (!raw) {
      issues.push({ code: "empty-json-ld", severity: "warning", message: `JSON-LD block ${index + 1} is empty.` });
      return;
    }
    try {
      JSON.parse(raw);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Invalid JSON";
      issues.push({
        code: "invalid-json-ld",
        severity: "error",
        message: `JSON-LD block ${index + 1} is not valid JSON: ${message}`,
      });
    }
  });

  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return { issues, totalIssues: issues.length, counts };
}

function summarize(title: string, issues: Array<{ severity: string; message: string }>): string {
  if (issues.length === 0) return `### ${title}: no issues`;
  const lines = issues.slice(0, 8).map((issue) => `- **${issue.severity}:** ${issue.message}`);
  return `### ${title}: ${issues.length} issue(s)\n${lines.join("\n")}`;
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "mcp-web-validator", version: SERVER_VERSION },
    {
      instructions:
        "A tiny local HTML checker. It only inspects markup you supply; it does not fetch URLs or write files.",
    },
  );

  server.registerTool(
    "seo.metadata",
    {
      title: "Audit SEO metadata",
      description:
        "Inspects supplied HTML locally for title, meta description, h1 headings, and image alt attributes.",
      inputSchema: {
        htmlContent: htmlContentSchema.describe("Raw HTML markup to inspect locally."),
      },
      outputSchema: {
        issues: z.array(issueSchema),
        totalIssues: z.number().int().nonnegative(),
        counts: z.object({
          error: z.number().int().nonnegative(),
          warning: z.number().int().nonnegative(),
          info: z.number().int().nonnegative(),
        }),
      },
      annotations: localReadOnlyAnnotations,
    },
    async ({ htmlContent }) => {
      const audit = auditSeoMetadata(htmlContent);
      return result(audit, summarize("SEO audit", audit.issues));
    },
  );

  server.registerTool(
    "schema.markup",
    {
      title: "Validate JSON-LD syntax",
      description:
        "Parses JSON-LD script blocks in supplied HTML and reports empty blocks or JSON syntax errors.",
      inputSchema: {
        htmlContent: htmlContentSchema.describe("Raw HTML containing JSON-LD script blocks."),
      },
      outputSchema: {
        issues: z.array(issueSchema),
        totalIssues: z.number().int().nonnegative(),
        counts: z.object({
          error: z.number().int().nonnegative(),
          warning: z.number().int().nonnegative(),
          info: z.number().int().nonnegative(),
        }),
      },
      annotations: localReadOnlyAnnotations,
    },
    async ({ htmlContent }) => {
      const audit = validateSchemaMarkup(htmlContent);
      return result(audit, summarize("JSON-LD syntax", audit.issues));
    },
  );

  return server;
}

export async function run(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error(`mcp-web-validator ${SERVER_VERSION} started on stdio`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  run().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error("Fatal error starting mcp-web-validator:", message);
    process.exitCode = 1;
  });
}
