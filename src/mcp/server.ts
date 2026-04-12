import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { getProjectFrontier, getProjectStatus } from "../app/services/project-state-service.js";
import {
  ResearchSessionOrchestratorService,
  type ResearchSessionCycleView,
  type ResearchSessionOrchestratorStep,
  type ResearchSessionOrchestratorStepResult,
} from "../app/services/research-session-orchestrator-service.js";
import {
  ResearchSessionRecoveryService,
  type ResearchSessionRecoveryInspection,
  type ResearchSessionRecoveryStatus,
} from "../app/services/research-session-recovery-service.js";
import { RunLoopService } from "../app/services/run-loop-service.js";
import type { DecisionRecord } from "../core/model/decision-record.js";
import type { ResearchSessionProgressSignal, ResearchSessionRecord } from "../core/model/research-session.js";
import type { RunRecord } from "../core/model/run-record.js";
import type { RunCycleServiceResult } from "../app/services/run-cycle-service.js";

export interface RalphResearchMcpServerOptions {
  repoRoot?: string;
  createResearchSessionOrchestratorService?: () => Pick<
    ResearchSessionOrchestratorService,
    "startSession" | "continueSession"
  >;
  createResearchSessionRecoveryService?: () => Pick<ResearchSessionRecoveryService, "inspectSession">;
}

export function createRalphResearchMcpServer(
  options: RalphResearchMcpServerOptions = {},
): McpServer {
  const defaultRepoRoot = resolve(options.repoRoot ?? process.cwd());
  const createResearchSessionOrchestratorService =
    options.createResearchSessionOrchestratorService ??
    (() => new ResearchSessionOrchestratorService());
  const createResearchSessionRecoveryService =
    options.createResearchSessionRecoveryService ??
    (() => new ResearchSessionRecoveryService());
  const server = new McpServer({
    name: "ralph-research",
    version: "0.1.3",
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
    "start_session",
    {
      description:
        "Start a persisted research session from a saved launch draft session id and return the first orchestrator checkpoint.",
      inputSchema: {
        repoRoot: z.string().optional().describe("Repository root; defaults to the server working directory."),
        draftSessionId: z.string().min(1).describe("Draft research session id to convert into a running session."),
      },
    },
    async ({ repoRoot, draftSessionId }) => {
      const service = createResearchSessionOrchestratorService();
      const result = await service.startSession({
        repoRoot: resolve(repoRoot ?? defaultRepoRoot),
        draftSessionId,
      });

      return createJsonToolResponse(serializeResearchSessionStepResult(result));
    },
  );

  server.registerTool(
    "resume_session",
    {
      description:
        "Resume or continue a persisted research session from its last completed cycle checkpoint and return a transport-safe session snapshot.",
      inputSchema: {
        repoRoot: z.string().optional().describe("Repository root; defaults to the server working directory."),
        sessionId: z.string().min(1).describe("Persisted research session id to resume or continue."),
      },
    },
    async ({ repoRoot, sessionId }) => {
      const resolvedRepoRoot = resolve(repoRoot ?? defaultRepoRoot);
      const orchestrator = createResearchSessionOrchestratorService();

      try {
        const result = await orchestrator.continueSession({
          repoRoot: resolvedRepoRoot,
          sessionId,
        });

        return createJsonToolResponse(serializeResearchSessionResumeResult(result));
      } catch (error) {
        const inspection = await inspectResumeFailure({
          repoRoot: resolvedRepoRoot,
          sessionId,
          createRecoveryService: createResearchSessionRecoveryService,
        });

        return createJsonToolResponse(
          serializeResearchSessionResumeFailure({
            error,
            inspection,
          }),
        );
      }
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

interface McpRunSummary {
  runId: string;
  cycle: number;
  candidateId: string;
  status: RunRecord["status"];
  phase: RunRecord["phase"];
  pendingAction: RunRecord["pendingAction"];
  startedAt: string;
  updatedAt: string | null;
  endedAt: string | null;
  decisionId: string | null;
}

interface McpDecisionSummary {
  decisionId: string;
  runId: string;
  outcome: DecisionRecord["outcome"];
  actorType: DecisionRecord["actorType"];
  policyType: string;
  createdAt: string;
  frontierChanged: boolean;
  delta: number | null;
  reason: string;
  commitSha: string | null;
}

interface McpRunCycleServiceResultSummary {
  status: RunCycleServiceResult["status"];
  manifestPath: string;
  lockPath: string;
  warning: string | null;
  recovery: RunCycleServiceResult["recovery"] | null;
  run: McpRunSummary | null;
  decision: McpDecisionSummary | null;
  frontierIds: string[];
}

interface McpResearchSessionPayload {
  step: ResearchSessionOrchestratorStep;
  session: {
    sessionId: string;
    status: ResearchSessionRecord["status"];
    goal: string;
    workingDirectory: string;
    agent: ResearchSessionRecord["agent"];
    context: ResearchSessionRecord["context"];
    workspace: ResearchSessionRecord["workspace"];
    stopPolicy: ResearchSessionRecord["stopPolicy"];
    progress: ResearchSessionRecord["progress"];
    stopCondition: ResearchSessionRecord["stopCondition"];
    resume: ResearchSessionRecord["resume"];
    createdAt: string;
    updatedAt: string;
    endedAt: string | null;
    evidenceBundlePath: string | null;
  };
  cycle: {
    completedCycles: number;
    nextCycle: number;
    latestRunId: string | null;
    latestDecisionId: string | null;
    latestFrontierIds: string[];
    lastSignals: ResearchSessionProgressSignal | null;
    run: McpRunSummary | null;
    decision: McpDecisionSummary | null;
    runResult: McpRunCycleServiceResultSummary | null;
  };
}

interface McpResearchSessionResumePayload {
  ok: true;
  error: null;
  recovery: null;
  step: ResearchSessionOrchestratorStep;
  session: McpResearchSessionPayload["session"];
  cycle: McpResearchSessionPayload["cycle"];
}

interface McpResearchSessionResumeFailurePayload {
  ok: false;
  error: string;
  recovery: ResearchSessionRecoveryStatus | null;
  step: "resume_failed";
  session: McpResearchSessionPayload["session"] | null;
  cycle: McpResearchSessionPayload["cycle"] | null;
}

function createJsonToolResponse(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function serializeResearchSessionStepResult(
  result: ResearchSessionOrchestratorStepResult,
): McpResearchSessionPayload {
  return {
    step: result.step,
    session: serializeResearchSessionRecord(result.session),
    cycle: serializeResearchSessionCycle(result.cycle),
  };
}

function serializeResearchSessionResumeResult(
  result: ResearchSessionOrchestratorStepResult,
): McpResearchSessionResumePayload {
  const payload = serializeResearchSessionStepResult(result);
  return {
    ok: true,
    error: null,
    recovery: null,
    step: payload.step,
    session: payload.session,
    cycle: payload.cycle,
  };
}

function serializeResearchSessionResumeFailure(input: {
  error: unknown;
  inspection: ResearchSessionRecoveryInspection | null;
}): McpResearchSessionResumeFailurePayload {
  return {
    ok: false,
    error: normalizeErrorMessage(input.error),
    recovery: input.inspection?.recovery ?? null,
    step: "resume_failed",
    session: input.inspection ? serializeResearchSessionRecord(input.inspection.session) : null,
    cycle: input.inspection ? createResearchSessionCycleSnapshot(input.inspection.session) : null,
  };
}

async function inspectResumeFailure(input: {
  repoRoot: string;
  sessionId: string;
  createRecoveryService: () => Pick<ResearchSessionRecoveryService, "inspectSession">;
}): Promise<ResearchSessionRecoveryInspection | null> {
  try {
    const recoveryService = input.createRecoveryService();
    return await recoveryService.inspectSession({
      repoRoot: input.repoRoot,
      sessionId: input.sessionId,
    });
  } catch {
    return null;
  }
}

function serializeResearchSessionRecord(
  session: ResearchSessionRecord,
): McpResearchSessionPayload["session"] {
  return {
    sessionId: session.sessionId,
    status: session.status,
    goal: session.goal,
    workingDirectory: session.workingDirectory,
    agent: session.agent,
    context: session.context,
    workspace: session.workspace,
    stopPolicy: session.stopPolicy,
    progress: session.progress,
    stopCondition: session.stopCondition,
    resume: session.resume,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    endedAt: session.endedAt ?? null,
    evidenceBundlePath: session.evidenceBundlePath ?? null,
  };
}

function createResearchSessionCycleSnapshot(
  session: ResearchSessionRecord,
): McpResearchSessionPayload["cycle"] {
  return {
    completedCycles: session.progress.completedCycles,
    nextCycle: session.progress.nextCycle,
    latestRunId: session.progress.latestRunId ?? null,
    latestDecisionId: session.progress.latestDecisionId ?? null,
    latestFrontierIds: session.progress.latestFrontierIds,
    lastSignals: session.progress.lastSignals ?? null,
    run: null,
    decision: null,
    runResult: null,
  };
}

function serializeResearchSessionCycle(
  cycle: ResearchSessionCycleView,
): McpResearchSessionPayload["cycle"] {
  return {
    completedCycles: cycle.completedCycles,
    nextCycle: cycle.nextCycle,
    latestRunId: cycle.latestRunId ?? null,
    latestDecisionId: cycle.latestDecisionId ?? null,
    latestFrontierIds: cycle.latestFrontierIds,
    lastSignals: cycle.lastSignals ?? null,
    run: cycle.run ? serializeRunRecordSummary(cycle.run) : null,
    decision: cycle.decision ? serializeDecisionRecordSummary(cycle.decision) : null,
    runResult: cycle.runResult ? serializeRunCycleServiceResult(cycle.runResult) : null,
  };
}

function serializeRunRecordSummary(run: RunRecord): McpRunSummary {
  return {
    runId: run.runId,
    cycle: run.cycle,
    candidateId: run.candidateId,
    status: run.status,
    phase: run.phase,
    pendingAction: run.pendingAction,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt ?? null,
    endedAt: run.endedAt ?? null,
    decisionId: run.decisionId ?? null,
  };
}

function serializeDecisionRecordSummary(decision: DecisionRecord): McpDecisionSummary {
  return {
    decisionId: decision.decisionId,
    runId: decision.runId,
    outcome: decision.outcome,
    actorType: decision.actorType,
    policyType: decision.policyType,
    createdAt: decision.createdAt,
    frontierChanged: decision.frontierChanged,
    delta: decision.delta ?? null,
    reason: decision.reason,
    commitSha: decision.commitSha ?? null,
  };
}

function serializeRunCycleServiceResult(
  runResult: RunCycleServiceResult,
): McpRunCycleServiceResultSummary {
  return {
    status: runResult.status,
    manifestPath: runResult.manifestPath,
    lockPath: runResult.lockPath,
    warning: runResult.warning ?? null,
    recovery: runResult.recovery ?? null,
    run: runResult.runResult?.run ? serializeRunRecordSummary(runResult.runResult.run) : null,
    decision: runResult.runResult?.decision
      ? serializeDecisionRecordSummary(runResult.runResult.decision)
      : null,
    frontierIds: runResult.runResult?.frontier.map((entry) => entry.frontierId) ?? [],
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to resume research session";
}
