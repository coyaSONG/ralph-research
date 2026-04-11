import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { compileManifestAdmission } from "../src/core/manifest/admission.js";
import { RalphManifestSchema } from "../src/core/manifest/schema.js";

const fixturesDir = new URL("./fixtures/manifests/", import.meta.url);

function buildBaseManifest() {
  return {
    schemaVersion: "0.1" as const,
    project: {
      name: "codex-cli-demo",
      artifact: "code" as const,
    },
    proposer: {
      type: "command" as const,
      command: "./scripts/propose.sh",
    },
    experiment: {
      run: {
        command: "./scripts/run.sh",
      },
    },
    metrics: {
      catalog: [
        {
          id: "quality",
          kind: "numeric" as const,
          direction: "maximize" as const,
          extractor: {
            type: "command" as const,
            command: "./scripts/metric.sh",
            parser: "plain_number" as const,
          },
        },
      ],
    },
    frontier: {
      strategy: "single_best" as const,
      primaryMetric: "quality",
    },
    ratchet: {
      type: "epsilon_improve" as const,
      metric: "quality",
      epsilon: 0,
    },
  };
}

async function readManifestFixture(name: string): Promise<unknown> {
  const source = await readFile(new URL(name, fixturesDir), "utf8");
  return parse(source);
}

describe("RalphManifestSchema codex_cli proposer", () => {
  it("parses a valid codex_cli fixture with codex-specific defaults once ttySession is declared", async () => {
    const manifest = RalphManifestSchema.parse(await readManifestFixture("valid-codex-cli.ralph.yaml"));

    expect(manifest.proposer).toMatchObject({
      type: "codex_cli",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      ttySession: {
        startupTimeoutSec: 30,
        turnTimeoutSec: 900,
      },
      history: {
        enabled: false,
        maxRuns: 5,
      },
    });
    expect("command" in manifest.proposer).toBe(false);
  });

  it("parses explicit codex_cli agent settings without overwriting provided values", () => {
    const manifest = RalphManifestSchema.parse({
      ...buildBaseManifest(),
      proposer: {
        type: "codex_cli",
        approvalPolicy: "on-request",
        sandboxMode: "danger-full-access",
        model: "gpt-5.4",
        ttySession: {
          startupTimeoutSec: 45,
          turnTimeoutSec: 1_200,
        },
        history: {
          enabled: true,
          maxRuns: 9,
        },
      },
    });

    expect(manifest.proposer).toMatchObject({
      type: "codex_cli",
      approvalPolicy: "on-request",
      sandboxMode: "danger-full-access",
      model: "gpt-5.4",
      ttySession: {
        startupTimeoutSec: 45,
        turnTimeoutSec: 1_200,
      },
      history: {
        enabled: true,
        maxRuns: 9,
      },
    });
  });

  it("applies dedicated research-session storage defaults separate from the session snapshot layout", () => {
    const manifest = RalphManifestSchema.parse(buildBaseManifest());

    expect(manifest.storage).toEqual({
      root: ".ralph",
      researchSession: {
        sessionsDir: "sessions",
        projectDefaultsFile: "project-defaults.json",
      },
    });
  });

  it("parses explicit research-session storage overrides without collapsing them into the session record", () => {
    const manifest = RalphManifestSchema.parse({
      ...buildBaseManifest(),
      storage: {
        root: ".rrx",
        researchSession: {
          sessionsDir: "orchestrator-sessions",
          projectDefaultsFile: "research-defaults.json",
        },
      },
    });

    expect(manifest.storage).toEqual({
      root: ".rrx",
      researchSession: {
        sessionsDir: "orchestrator-sessions",
        projectDefaultsFile: "research-defaults.json",
      },
    });
  });

  it("parses codex_cli strategies inside parallel proposers", () => {
    const manifest = RalphManifestSchema.parse({
      ...buildBaseManifest(),
      proposer: {
        type: "parallel",
        pickBest: "highest_metric",
        strategies: [
          {
            type: "command",
            command: "./scripts/propose-command.sh",
          },
          {
            type: "codex_cli",
            approvalPolicy: "never",
            sandboxMode: "workspace-write",
            ttySession: {
              startupTimeoutSec: 20,
              turnTimeoutSec: 600,
            },
          },
        ],
      },
    });

    expect(manifest.proposer.type).toBe("parallel");
    expect(manifest.proposer.strategies[1]).toMatchObject({
      type: "codex_cli",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      ttySession: {
        startupTimeoutSec: 20,
        turnTimeoutSec: 600,
      },
      history: {
        enabled: false,
        maxRuns: 5,
      },
    });
  });

  it("rejects legacy one-shot command settings on codex_cli proposers", () => {
    expect(() =>
      RalphManifestSchema.parse({
        ...buildBaseManifest(),
        proposer: {
          type: "codex_cli",
          ttySession: {},
          command: "codex exec",
        },
      })
    ).toThrowError(/unrecognized key/i);
  });

  it("requires an explicit ttySession block for codex_cli proposers", () => {
    expect(() =>
      RalphManifestSchema.parse({
        ...buildBaseManifest(),
        proposer: {
          type: "codex_cli",
        },
      })
    ).toThrowError(/ttySession/i);
  });

  it("rejects unsupported approvalPolicy values on codex_cli proposers", () => {
    expect(() =>
      RalphManifestSchema.parse({
        ...buildBaseManifest(),
        proposer: {
          type: "codex_cli",
          approvalPolicy: "sometimes",
          ttySession: {},
        },
      })
    ).toThrowError(/approvalPolicy/i);
  });

  it("rejects unsupported sandboxMode values on codex_cli proposers", () => {
    expect(() =>
      RalphManifestSchema.parse({
        ...buildBaseManifest(),
        proposer: {
          type: "codex_cli",
          sandboxMode: "unsafe",
          ttySession: {},
        },
      })
    ).toThrowError(/sandboxMode/i);
  });

  it("rejects unexpected ttySession fields on codex_cli proposers", () => {
    expect(() =>
      RalphManifestSchema.parse({
        ...buildBaseManifest(),
        proposer: {
          type: "codex_cli",
          ttySession: {
            startupTimeoutSec: 30,
            turnTimeoutSec: 900,
            transcriptPath: ".rrx/session.log",
          },
        },
      })
    ).toThrowError(/unrecognized key/i);
  });

  it("marks codex_cli proposers as non-executable until the TUI orchestrator exists", async () => {
    const manifest = RalphManifestSchema.parse({
      ...buildBaseManifest(),
      proposer: {
        type: "codex_cli",
        ttySession: {},
      },
    });

    const admission = await compileManifestAdmission(manifest);

    expect(admission).toMatchObject({
      executable: false,
      issues: [
        expect.objectContaining({
          code: "unsupported_capability",
          path: ["proposer", "type"],
        }),
      ],
    });
  });
});
