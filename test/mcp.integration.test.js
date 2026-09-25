import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("stdio MCP exposes two tools and returns local audit results", { timeout: 10_000 }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repositoryRoot, "dist", "index.js")],
    stderr: "pipe",
  });
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["schema.markup", "seo.metadata"]);

    const seo = await client.callTool({
      name: "seo.metadata",
      arguments: {
        htmlContent: "<!doctype html><html><head></head><body><h1>Test</h1><img src=x></body></html>",
      },
    });
    assert.equal(seo.isError, undefined);
    assert.ok(Array.isArray(seo.structuredContent?.issues));
    assert.ok(seo.structuredContent.issues.some((issue) => issue.code === "missing-title"));

    const schema = await client.callTool({
      name: "schema.markup",
      arguments: {
        htmlContent: '<script type="application/ld+json">{ "name": "ok" }</script>',
      },
    });
    assert.equal(schema.isError, undefined);
    assert.equal(schema.structuredContent.totalIssues, 0);
  } finally {
    await client.close();
  }
});
