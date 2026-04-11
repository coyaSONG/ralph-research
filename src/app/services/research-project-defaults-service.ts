import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { JsonFileResearchProjectDefaultsStore } from "../../adapters/fs/json-file-research-project-defaults-store.js";
import {
  DEFAULT_PROJECT_BASELINE_REF,
  DEFAULT_RESEARCH_PROJECT_DEFAULTS_FILE,
  DEFAULT_STORAGE_ROOT,
} from "../../core/manifest/defaults.js";
import {
  researchProjectDefaultsRecordSchema,
  type ResearchProjectDefaultsRecord,
} from "../../core/model/research-project-defaults.js";
import type { ResearchSessionRecord } from "../../core/model/research-session.js";
import type { ResearchProjectDefaultsStore } from "../../core/ports/research-project-defaults-store.js";

export interface ResearchProjectDefaultsServiceDependencies {
  now?: () => Date;
  createStore?: (filePath: string) => ResearchProjectDefaultsStore;
}

export class ResearchProjectDefaultsService {
  private readonly now: () => Date;
  private readonly createStore: (filePath: string) => ResearchProjectDefaultsStore;

  public constructor(dependencies: ResearchProjectDefaultsServiceDependencies = {}) {
    this.now = dependencies.now ?? (() => new Date());
    this.createStore =
      dependencies.createStore ?? ((filePath) => new JsonFileResearchProjectDefaultsStore(filePath));
  }

  public async loadForRepo(repoRoot: string): Promise<ResearchProjectDefaultsRecord | null> {
    const { store } = await this.resolveStore(repoRoot);
    return store.load();
  }

  public async saveForSession(input: {
    repoRoot: string;
    session: ResearchSessionRecord;
  }): Promise<ResearchProjectDefaultsRecord> {
    const { store } = await this.resolveStore(input.repoRoot);
    const existing = await store.load();
    const timestamp = this.now().toISOString();
    const contract = deriveProjectDefaultsContract(input.session);
    const record = researchProjectDefaultsRecordSchema.parse({
      recordType: "research_project_defaults",
      version: 1,
      ...contract,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });

    await store.save(record);

    return record;
  }

  private async resolveStore(repoRoot: string): Promise<{
    canonicalRepoRoot: string;
    store: ResearchProjectDefaultsStore;
  }> {
    const resolvedRoot = resolve(repoRoot);
    const repoStats = await stat(resolvedRoot).catch(() => null);
    if (!repoStats?.isDirectory()) {
      throw new Error(`Working directory is not a directory: ${resolvedRoot}`);
    }

    const canonicalRepoRoot = await realpath(resolvedRoot);
    const defaultsPath = join(
      canonicalRepoRoot,
      DEFAULT_STORAGE_ROOT,
      DEFAULT_RESEARCH_PROJECT_DEFAULTS_FILE,
    );

    return {
      canonicalRepoRoot,
      store: this.createStore(defaultsPath),
    };
  }
}

function deriveProjectDefaultsContract(
  session: ResearchSessionRecord,
): Pick<
  ResearchProjectDefaultsRecord,
  "workingDirectory" | "context" | "workspace" | "agent" | "stopPolicy"
> {
  const permissions = session.draftState?.flowState?.permissions;
  const stopRules = session.draftState?.flowState?.stopRules;
  const outputs = session.draftState?.flowState?.outputs;
  const contextStep = session.draftState?.contextStep;
  const workspaceStep = session.draftState?.workspaceStep;
  const goalStep = session.draftState?.goalStep;
  const agentStep = session.draftState?.agentStep;
  const resolvedModel = resolveOptionalString(
    outputs?.model ?? agentStep?.model ?? session.agent.model,
  );

  return {
    workingDirectory: resolveRequiredString(
      permissions?.workingDirectory ?? workspaceStep?.workingDirectory,
      session.workingDirectory,
      "Working directory",
    ),
    context: {
      trackableGlobs: resolveStringList(
        outputs?.trackableGlobs ?? contextStep?.trackableGlobs,
        session.context.trackableGlobs,
        "Trackable files",
      ),
      webSearch: resolveWebSearchChoice(
        permissions?.webSearch ?? contextStep?.webSearch,
        session.context.webSearch,
      ),
      shellCommandAllowlistAdditions: resolveStringList(
        permissions?.shellCommandAllowlistAdditions ??
          contextStep?.shellCommandAllowlistAdditions,
        session.context.shellCommandAllowlistAdditions,
        "Shell allowlist additions",
        { allowEmpty: true },
      ),
      shellCommandAllowlistRemovals: resolveStringList(
        permissions?.shellCommandAllowlistRemovals ??
          contextStep?.shellCommandAllowlistRemovals,
        session.context.shellCommandAllowlistRemovals,
        "Shell allowlist removals",
        { allowEmpty: true },
      ),
    },
    workspace: {
      strategy: "git_worktree",
      baseRef: resolveRequiredString(
        outputs?.baseRef ?? workspaceStep?.baseRef,
        session.workspace.baseRef ?? DEFAULT_PROJECT_BASELINE_REF,
        "Baseline ref",
      ),
    },
    agent: {
      type: session.agent.type,
      command: resolveRequiredString(
        outputs?.agentCommand ?? goalStep?.agentCommand ?? agentStep?.command,
        session.agent.command,
        "Agent command",
      ),
      ...(resolvedModel ? { model: resolvedModel } : {}),
      approvalPolicy: resolveAgentApprovalPolicy(
        permissions?.approvalPolicy ?? agentStep?.approvalPolicy,
        session.agent.approvalPolicy,
      ),
      sandboxMode: resolveAgentSandboxMode(
        permissions?.sandboxMode ?? agentStep?.sandboxMode,
        session.agent.sandboxMode,
      ),
      ttySession: {
        startupTimeoutSec: resolvePositiveInteger(
          outputs?.startupTimeoutSec ?? agentStep?.startupTimeoutSec,
          session.agent.ttySession.startupTimeoutSec,
          "Agent startup timeout",
        ),
        turnTimeoutSec: resolvePositiveInteger(
          outputs?.turnTimeoutSec ?? agentStep?.turnTimeoutSec,
          session.agent.ttySession.turnTimeoutSec,
          "Agent turn timeout",
        ),
      },
    },
    stopPolicy: {
      repeatedFailures: resolvePositiveInteger(
        stopRules?.repeatedFailures ?? goalStep?.repeatedFailures,
        session.stopPolicy.repeatedFailures,
        "Repeated failures threshold",
      ),
      noMeaningfulProgress: resolvePositiveInteger(
        stopRules?.noMeaningfulProgress ?? goalStep?.noMeaningfulProgress,
        session.stopPolicy.noMeaningfulProgress,
        "No-progress threshold",
      ),
      insufficientEvidence: resolvePositiveInteger(
        stopRules?.insufficientEvidence ?? goalStep?.insufficientEvidence,
        session.stopPolicy.insufficientEvidence,
        "Insufficient-evidence threshold",
      ),
    },
  };
}

function resolveRequiredString(
  draftValue: string | undefined,
  fallbackValue: string,
  label: string,
): string {
  const normalized = draftValue?.trim() ?? "";
  if (normalized) {
    return normalized;
  }

  const fallback = fallbackValue.trim();
  if (!fallback) {
    throw new Error(`${label} is required`);
  }

  return fallback;
}

function resolveOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : undefined;
}

function resolveStringList(
  draftValue: string | undefined,
  fallback: readonly string[],
  label: string,
  options: {
    allowEmpty?: boolean;
  } = {},
): string[] {
  if (draftValue === undefined) {
    return [...fallback];
  }

  const values = draftValue
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (values.length === 0) {
    if (options.allowEmpty) {
      return [];
    }
    return [...fallback];
  }

  return values;
}

function resolveWebSearchChoice(draftValue: string | undefined, fallback: boolean): boolean {
  if (draftValue === undefined) {
    return fallback;
  }

  const normalized = draftValue.trim().toLowerCase();
  if (normalized === "enabled") {
    return true;
  }
  if (normalized === "disabled") {
    return false;
  }

  return fallback;
}

function resolvePositiveInteger(
  draftValue: string | undefined,
  fallback: number,
  label: string,
): number {
  if (draftValue === undefined) {
    return fallback;
  }

  const normalized = draftValue.trim();
  if (!/^\d+$/.test(normalized)) {
    return fallback;
  }

  const value = Number.parseInt(normalized, 10);
  if (value < 1) {
    return fallback;
  }

  return value;
}

function resolveAgentApprovalPolicy(
  draftValue: string | undefined,
  fallback: ResearchSessionRecord["agent"]["approvalPolicy"],
): ResearchSessionRecord["agent"]["approvalPolicy"] {
  if (draftValue === undefined) {
    return fallback;
  }

  const normalized = draftValue.trim();
  switch (normalized) {
    case "never":
    case "on-failure":
    case "on-request":
    case "untrusted":
      return normalized;
    default:
      return fallback;
  }
}

function resolveAgentSandboxMode(
  draftValue: string | undefined,
  fallback: ResearchSessionRecord["agent"]["sandboxMode"],
): ResearchSessionRecord["agent"]["sandboxMode"] {
  if (draftValue === undefined) {
    return fallback;
  }

  const normalized = draftValue.trim();
  switch (normalized) {
    case "read-only":
    case "workspace-write":
    case "danger-full-access":
      return normalized;
    default:
      return fallback;
  }
}
