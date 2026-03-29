import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { getProjectFrontier, getProjectStatus } from "../app/services/project-state-service.js";
import { RunCycleService } from "../app/services/run-cycle-service.js";

export interface RalphResearchMcpServerOptions {
  repoRoot?: string;
}

export function createRalphResearchMcpServer(
  options: RalphResearchMcpServerOptions = {},
): McpServer {
  const defaultRepoRoot = resolve(options.repoRoot ?? process.cwd());
  const server = new McpServer({
    name: "ralph-research",
    version: "0.1.0",
  });

  server.registerTool(
    "run_research_cycle",
    {
      description: "Run one or more research cycles using the shared ralph-research service layer.",
      inputSchema: {
        repoRoot: z.string().optional().describe("Repository root; defaults to the server working directory."),
        manifestPath: z.string().optional().describe("Optional path to the manifest file."),
        cycles: z.number().int().min(1).max(20).default(1).describe("Number of cycles to run."),
        resume: z.boolean().default(false).describe("Resume the latest run if it is recoverable."),
      },
    },
    async ({ repoRoot, manifestPath, cycles = 1, resume = false }) => {
      const service = new RunCycleService();
      const resolvedRepoRoot = resolve(repoRoot ?? defaultRepoRoot);
      const results = [];

      for (let index = 0; index < cycles; index += 1) {
        const result = await service.run({
          repoRoot: resolvedRepoRoot,
          ...(manifestPath ? { manifestPath } : {}),
          resume,
        });
        results.push(result);

        if (result.status === "failed" || result.status === "resume_required") {
          break;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: results.every((result) => result.status !== "failed" && result.status !== "resume_required"),
                cycles,
                results,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_research_status",
    {
      description: "Get the latest run, frontier summary, and pending human review items.",
      inputSchema: {
        repoRoot: z.string().optional().describe("Repository root; defaults to the server working directory."),
        manifestPath: z.string().optional().describe("Optional path to the manifest file."),
      },
    },
    async ({ repoRoot, manifestPath }) => {
      const payload = await getProjectStatus({
        repoRoot: resolve(repoRoot ?? defaultRepoRoot),
        ...(manifestPath ? { manifestPath } : {}),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_frontier",
    {
      description: "Get the current frontier entries for the active manifest.",
      inputSchema: {
        repoRoot: z.string().optional().describe("Repository root; defaults to the server working directory."),
        manifestPath: z.string().optional().describe("Optional path to the manifest file."),
      },
    },
    async ({ repoRoot, manifestPath }) => {
      const payload = await getProjectFrontier({
        repoRoot: resolve(repoRoot ?? defaultRepoRoot),
        ...(manifestPath ? { manifestPath } : {}),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

export async function startMcpServer(
  options: RalphResearchMcpServerOptions = {},
): Promise<McpServer> {
  const server = createRalphResearchMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
