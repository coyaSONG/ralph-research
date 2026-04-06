import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { getProjectFrontier, getProjectStatus } from "../app/services/project-state-service.js";
import { RunLoopService } from "../app/services/run-loop-service.js";

export interface RalphResearchMcpServerOptions {
  repoRoot?: string;
}

export function createRalphResearchMcpServer(
  options: RalphResearchMcpServerOptions = {},
): McpServer {
  const defaultRepoRoot = resolve(options.repoRoot ?? process.cwd());
  const server = new McpServer({
    name: "ralph-research",
    version: "0.1.2",
  });

  server.registerTool(
    "run_research_cycle",
    {
      description: "Run one or more research cycles using the shared ralph-research service layer.",
      inputSchema: {
        repoRoot: z.string().optional().describe("Repository root; defaults to the server working directory."),
        manifestPath: z.string().optional().describe("Optional path to the manifest file."),
        cycles: z.number().int().min(1).max(100).optional().describe("Exact cycle count, or a max-cycle cap when used with progressive stop flags."),
        untilTarget: z.boolean().default(false).describe("Keep running until manifest.stopping.target is met."),
        untilNoImprove: z.number().int().min(1).max(100).optional().describe("Stop after N consecutive cycles without frontier improvement."),
        fresh: z.boolean().default(false).describe("Start a fresh run instead of auto-resuming the latest recoverable run."),
      },
    },
    async ({ repoRoot, manifestPath, cycles, untilTarget = false, untilNoImprove, fresh = false }) => {
      const service = new RunLoopService();
      const resolvedRepoRoot = resolve(repoRoot ?? defaultRepoRoot);
      const result = await service.run({
        repoRoot: resolvedRepoRoot,
        ...(manifestPath ? { manifestPath } : {}),
        ...(cycles === undefined ? {} : { cycles }),
        ...(untilTarget ? { untilTarget } : {}),
        ...(untilNoImprove === undefined ? {} : { untilNoImprove }),
        fresh,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
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
