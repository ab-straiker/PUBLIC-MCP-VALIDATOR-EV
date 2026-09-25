#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare const SERVER_VERSION = "1.0.0";
export declare function auditSeoMetadata(html: string): {
    issues: {
        code: string;
        severity: "error" | "warning" | "info";
        message: string;
    }[];
    totalIssues: number;
    counts: {
        error: number;
        warning: number;
        info: number;
    };
};
export declare function validateSchemaMarkup(html: string): {
    issues: {
        code: string;
        severity: "error" | "warning" | "info";
        message: string;
    }[];
    totalIssues: number;
    counts: {
        error: number;
        warning: number;
        info: number;
    };
};
export declare function createServer(): McpServer;
export declare function run(): Promise<void>;
