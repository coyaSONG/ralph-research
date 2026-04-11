export const DEFAULT_MANIFEST_FILENAME = "ralph.yaml";
export const DEFAULT_SCHEMA_VERSION = "0.1" as const;
export const DEFAULT_STORAGE_ROOT = ".ralph";
export const DEFAULT_PROJECT_BASELINE_REF = "main";
export const DEFAULT_PROJECT_WORKSPACE = "git" as const;
export const DEFAULT_COMMAND_TIMEOUT_SEC = 600;
export const DEFAULT_ALLOWED_GLOBS = ["**/*.md", "**/*.txt", "**/*.py", "**/*.ts", "**/*.tsx"];
export const DEFAULT_MAX_FILES_CHANGED = 5;
export const DEFAULT_MAX_LINE_DELTA = 200;
export const DEFAULT_JUDGE_REPEATS = 3;
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.75;
export const DEFAULT_ANCHOR_MIN_AGREEMENT = 0.8;
export const DEFAULT_AUDIT_SAMPLE_RATE = 0.1;
export const DEFAULT_PROPOSER_EXPLORATION_RATIO = 0.3;
export const DEFAULT_STAGNATION_AFTER_REJECTIONS = 3;
export const DEFAULT_MAX_PATCH_COUNT = 1;
export const DEFAULT_PROPOSER_HISTORY_MAX_RUNS = 5;
export const DEFAULT_SESSION_REPEATED_FAILURE_LIMIT = 3;
export const DEFAULT_SESSION_NO_PROGRESS_LIMIT = 5;
export const DEFAULT_SESSION_INSUFFICIENT_EVIDENCE_LIMIT = 3;
export const DEFAULT_CODEX_CLI_APPROVAL_POLICY = "never" as const;
export const DEFAULT_CODEX_CLI_SANDBOX_MODE = "workspace-write" as const;
export const DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC = 30;
export const DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC = 900;
export const DEFAULT_RESEARCH_SESSIONS_DIR = "sessions";
export const DEFAULT_RESEARCH_PROJECT_DEFAULTS_FILE = "project-defaults.json";

export const manifestDefaults = {
  schemaVersion: DEFAULT_SCHEMA_VERSION,
  project: {
    baselineRef: DEFAULT_PROJECT_BASELINE_REF,
    workspace: DEFAULT_PROJECT_WORKSPACE,
  },
  scope: {
    allowedGlobs: DEFAULT_ALLOWED_GLOBS,
    maxFilesChanged: DEFAULT_MAX_FILES_CHANGED,
    maxLineDelta: DEFAULT_MAX_LINE_DELTA,
  },
  command: {
    timeoutSec: DEFAULT_COMMAND_TIMEOUT_SEC,
  },
  judgePack: {
    repeats: DEFAULT_JUDGE_REPEATS,
    lowConfidenceThreshold: DEFAULT_LOW_CONFIDENCE_THRESHOLD,
    anchors: {
      minAgreementWithHuman: DEFAULT_ANCHOR_MIN_AGREEMENT,
    },
    audit: {
      sampleRate: DEFAULT_AUDIT_SAMPLE_RATE,
      freezeAutoAcceptIfAnchorFails: true,
    },
  },
  proposer: {
    explorationRatio: DEFAULT_PROPOSER_EXPLORATION_RATIO,
    stagnationAfterRejections: DEFAULT_STAGNATION_AFTER_REJECTIONS,
    maxPatchCount: DEFAULT_MAX_PATCH_COUNT,
    codexCli: {
      approvalPolicy: DEFAULT_CODEX_CLI_APPROVAL_POLICY,
      sandboxMode: DEFAULT_CODEX_CLI_SANDBOX_MODE,
      ttySession: {
        startupTimeoutSec: DEFAULT_TTY_SESSION_STARTUP_TIMEOUT_SEC,
        turnTimeoutSec: DEFAULT_TTY_SESSION_TURN_TIMEOUT_SEC,
      },
    },
    history: {
      enabled: false,
      maxRuns: DEFAULT_PROPOSER_HISTORY_MAX_RUNS,
    },
  },
  storage: {
    root: DEFAULT_STORAGE_ROOT,
    researchSession: {
      sessionsDir: DEFAULT_RESEARCH_SESSIONS_DIR,
      projectDefaultsFile: DEFAULT_RESEARCH_PROJECT_DEFAULTS_FILE,
    },
  },
} as const;
