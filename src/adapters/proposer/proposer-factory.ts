import type { LeafProposerConfig } from "../../core/manifest/schema.js";
import type { CodexCliCycleSessionContext } from "../../core/model/codex-cli-cycle-session.js";
import type { ProposalAdapterMetadata } from "../../core/model/run-record.js";
import { CodexCliSessionProposer, type CodexCliSessionProposerDependencies } from "./codex-cli-proposer.js";
import {
  runCommandProposer,
  type CommandProposalResult,
  type RunCommandProposerInput,
} from "./command-proposer.js";

export interface ProposalExecutionInput extends RunCommandProposerInput {
  codexSession?: CodexCliCycleSessionContext;
}
export interface ProposalExecutionResult {
  proposerType: CommandProposalResult["proposerType"] | "codex_cli";
  stdout: string;
  stderr: string;
  summary: string;
  adapterMetadata?: ProposalAdapterMetadata;
}

export interface ProposerRunner {
  run(input: ProposalExecutionInput): Promise<ProposalExecutionResult>;
}

export interface ProposerFactoryDependencies extends CodexCliSessionProposerDependencies {
  runCommand?: typeof runCommandProposer;
}

export function createProposerRunner(
  proposer: LeafProposerConfig,
  dependencies: ProposerFactoryDependencies = {},
): ProposerRunner {
  switch (proposer.type) {
    case "command":
      return {
        run: (input) => (dependencies.runCommand ?? runCommandProposer)(proposer, input),
      };
    case "codex_cli":
      return new CodexCliSessionProposer(proposer, {
        ...(dependencies.createSessionManager ? { createSessionManager: dependencies.createSessionManager } : {}),
        ...(dependencies.createSessionId ? { createSessionId: dependencies.createSessionId } : {}),
        ...(dependencies.now ? { now: dependencies.now } : {}),
      });
    default:
      throw new Error(`unsupported proposer type ${proposer.type} in cycle runner`);
  }
}
