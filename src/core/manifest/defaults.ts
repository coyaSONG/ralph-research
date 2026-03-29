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
    history: {
      enabled: false,
      maxRuns: DEFAULT_PROPOSER_HISTORY_MAX_RUNS,
    },
  },
  storage: {
    root: DEFAULT_STORAGE_ROOT,
  },
} as const;
