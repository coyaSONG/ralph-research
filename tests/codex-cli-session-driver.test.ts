import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  CodexCliSessionDriver,
  type CodexCliInteractiveSession,
} from "../src/adapters/proposer/codex-cli-session-driver.js";
import { extractCodexCliSessionOutcome } from "../src/adapters/proposer/codex-cli-session-outcome-extractor.js";
import {
  CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER,
  CODEX_CLI_SESSION_OUTCOME_END_MARKER,
} from "../src/core/model/codex-cli-session-outcome.js";

class FakeInteractiveSession implements CodexCliInteractiveSession {
  public readonly pid = 4242;
  public readonly stdin: NodeJS.WritableStream;
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly stopSignals: Array<NodeJS.Signals | undefined> = [];

  private readonly exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private resolveExit: ((value: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  private stopped = false;

  public constructor(dependencies: { stdin?: NodeJS.WritableStream } = {}) {
    this.stdin = dependencies.stdin ?? new PassThrough();
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  public waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return this.exitPromise;
  }

  public stop(signal?: NodeJS.Signals): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    this.stopped = true;
    this.stopSignals.push(signal);
    this.finish(null, signal ?? "SIGTERM");
    return this.exitPromise;
  }

  public finish(code: number | null, signal: NodeJS.Signals | null): void {
    this.resolveExit?.({ code, signal });
  }

  public wasStopped(): boolean {
    return this.stopped;
  }
}

class ScriptedWritable extends EventEmitter {
  public readonly chunks: string[] = [];

  private readonly pendingErrors: Error[] = [];
  private pendingBackpressureCount = 0;

  public queueBackpressureOnce(): void {
    this.pendingBackpressureCount += 1;
  }

  public queueWriteError(error: Error): void {
    this.pendingErrors.push(error);
  }

  public flushDrain(): void {
    this.emit("drain");
  }

  public write(chunk: string, _encoding: BufferEncoding): boolean {
    this.chunks.push(chunk);

    const error = this.pendingErrors.shift();
    if (error) {
      queueMicrotask(() => {
        this.emit("error", error);
      });
      return false;
    }

    if (this.pendingBackpressureCount > 0) {
      this.pendingBackpressureCount -= 1;
      return false;
    }

    return true;
  }
}

describe("CodexCliSessionDriver", () => {
  it("sends the research prompt and control input while capturing an ordered transcript", async () => {
    const session = new FakeInteractiveSession();
    let tick = 0;
    const stdinChunks: string[] = [];
    session.stdin.on("data", (chunk) => {
      stdinChunks.push(chunk.toString("utf8"));
    });

    const driver = new CodexCliSessionDriver("session-001", session, {
      now: () => new Date(Date.UTC(2026, 3, 12, 0, 0, tick++)),
    });

    const resultPromise = driver.run({
      researchPrompt: "Research the future holdout top-3 horse-racing demo.",
      controlInputs: [
        {
          text: "Continue autonomously until you either reach goal achieved or halt.",
          label: "continue",
        },
        "Leave evidence in workspace files only.",
      ],
    });

    await waitForCondition(() => stdinChunks.length === 3);

    session.stdout.write("Planning cycle 1...\n");
    session.stderr.write("warning: metric regression detected\n");
    session.stdout.write("Queued verification run.\n");
    session.finish(0, null);

    const result = await resultPromise;

    expect(stdinChunks.join("")).toBe(
      [
        "Research the future holdout top-3 horse-racing demo.\n",
        "Continue autonomously until you either reach goal achieved or halt.\n",
        "Leave evidence in workspace files only.\n",
      ].join(""),
    );
    expect(result.exit).toEqual({
      code: 0,
      signal: null,
    });
    expect(result.transcript).toMatchObject({
      sessionId: "session-001",
      pid: 4242,
      exit: {
        code: 0,
        signal: null,
      },
    });
    expect(result.transcript.entries).toEqual([
      expect.objectContaining({
        order: 1,
        stream: "stdin",
        inputType: "research_prompt",
        text: "Research the future holdout top-3 horse-racing demo.\n",
      }),
      expect.objectContaining({
        order: 2,
        stream: "stdin",
        inputType: "control",
        label: "continue",
        text: "Continue autonomously until you either reach goal achieved or halt.\n",
      }),
      expect.objectContaining({
        order: 3,
        stream: "stdin",
        inputType: "control",
        text: "Leave evidence in workspace files only.\n",
      }),
      expect.objectContaining({
        order: 4,
        stream: "stdout",
        text: "Planning cycle 1...\n",
      }),
      expect.objectContaining({
        order: 5,
        stream: "stderr",
        text: "warning: metric regression detected\n",
      }),
      expect.objectContaining({
        order: 6,
        stream: "stdout",
        text: "Queued verification run.\n",
      }),
    ]);
  });

  it("supports manual control input and finalizes the transcript once when stopped", async () => {
    const session = new FakeInteractiveSession();
    let tick = 0;
    const stdinChunks: string[] = [];
    session.stdin.on("data", (chunk) => {
      stdinChunks.push(chunk.toString("utf8"));
    });

    const driver = new CodexCliSessionDriver("session-002", session, {
      now: () => new Date(Date.UTC(2026, 3, 12, 0, 1, tick++)),
    });

    await driver.sendResearchPrompt("Start cycle analysis.");
    await driver.sendControlInput({
      text: "y",
      label: "confirm",
      appendNewline: false,
    });

    session.stdout.write("Awaiting confirmation...\n");

    const exit = await driver.stop("SIGINT");

    expect(session.wasStopped()).toBe(true);
    expect(exit).toEqual({
      code: null,
      signal: "SIGINT",
    });
    expect(stdinChunks.join("")).toBe("Start cycle analysis.\ny");

    const transcript = driver.getTranscript();
    expect(transcript.exit).toEqual({
      code: null,
      signal: "SIGINT",
    });
    expect(transcript.entries).toEqual([
      expect.objectContaining({
        order: 1,
        stream: "stdin",
        inputType: "research_prompt",
        text: "Start cycle analysis.\n",
      }),
      expect.objectContaining({
        order: 2,
        stream: "stdin",
        inputType: "control",
        label: "confirm",
        text: "y",
      }),
      expect.objectContaining({
        order: 3,
        stream: "stdout",
        text: "Awaiting confirmation...\n",
      }),
    ]);

    session.stderr.write("late output should be ignored\n");
    expect(driver.getTranscript().entries).toHaveLength(3);
  });

  it("rejects blank research prompts and control input", async () => {
    const session = new FakeInteractiveSession();
    const driver = new CodexCliSessionDriver("session-003", session);

    await expect(driver.sendResearchPrompt("   ")).rejects.toThrow("Research prompt is required");
    await expect(driver.sendControlInput("   ")).rejects.toThrow("Control input is required");
  });

  it("serializes prompt and follow-up control writes across TTY backpressure", async () => {
    const stdin = new ScriptedWritable();
    stdin.queueBackpressureOnce();

    const session = new FakeInteractiveSession({
      stdin: stdin as unknown as NodeJS.WritableStream,
    });
    const driver = new CodexCliSessionDriver("session-005", session);

    const promptPromise = driver.sendResearchPrompt("Plan the next cycle.\n");
    const controlPromise = driver.sendControlInput({
      text: "Resume autonomous research.\n",
      label: "resume",
    });

    await waitForCondition(() => stdin.chunks.length === 1);

    expect(stdin.chunks).toEqual(["Plan the next cycle.\n"]);
    expect(driver.getTranscript().entries).toEqual([
      expect.objectContaining({
        order: 1,
        stream: "stdin",
        inputType: "research_prompt",
        text: "Plan the next cycle.\n",
      }),
    ]);

    stdin.flushDrain();
    await Promise.all([promptPromise, controlPromise]);

    expect(stdin.chunks).toEqual([
      "Plan the next cycle.\n",
      "Resume autonomous research.\n",
    ]);
    expect(driver.getTranscript().entries).toEqual([
      expect.objectContaining({
        order: 1,
        stream: "stdin",
        inputType: "research_prompt",
        text: "Plan the next cycle.\n",
      }),
      expect.objectContaining({
        order: 2,
        stream: "stdin",
        inputType: "control",
        label: "resume",
        text: "Resume autonomous research.\n",
      }),
    ]);
  });

  it("keeps transcript finalization stable when waitForExit and stop race", async () => {
    let tick = 0;
    const session = new FakeInteractiveSession();
    const driver = new CodexCliSessionDriver("session-006", session, {
      now: () => new Date(Date.UTC(2026, 3, 12, 0, 3, tick++)),
    });

    await driver.sendResearchPrompt("Checkpoint the current session.");

    const waitPromise = driver.waitForExit();
    const stopPromise = driver.stop("SIGTERM");
    const [waitExit, stopExit] = await Promise.all([waitPromise, stopPromise]);

    expect(session.stopSignals).toEqual(["SIGTERM"]);
    expect(waitExit).toEqual({
      code: null,
      signal: "SIGTERM",
    });
    expect(stopExit).toEqual(waitExit);

    const transcript = driver.getTranscript();
    expect(transcript.exit).toEqual(waitExit);
    expect(transcript.endedAt).toBe("2026-04-12T00:03:02.000Z");
    expect(transcript.updatedAt).toBe("2026-04-12T00:03:02.000Z");

    session.stdout.write("late output should be ignored after exit\n");
    expect(driver.getTranscript().entries).toEqual([
      expect.objectContaining({
        order: 1,
        stream: "stdin",
        inputType: "research_prompt",
        text: "Checkpoint the current session.\n",
      }),
    ]);
  });

  it("recovers queued terminal input after a transient write error and captures buffer output", async () => {
    const stdin = new ScriptedWritable();
    stdin.queueWriteError(new Error("broken pipe"));

    const session = new FakeInteractiveSession({
      stdin: stdin as unknown as NodeJS.WritableStream,
    });
    const driver = new CodexCliSessionDriver("session-007", session);

    await expect(driver.sendResearchPrompt("First attempt.")).rejects.toThrow("broken pipe");
    await driver.sendControlInput("Retry after reconnect.");

    session.stdout.write(Buffer.from("terminal recovered\n", "utf8"));
    session.stderr.write(Buffer.from("warning: replayed prompt\n", "utf8"));
    session.finish(0, null);

    await expect(driver.waitForExit()).resolves.toEqual({
      code: 0,
      signal: null,
    });
    expect(stdin.chunks).toEqual([
      "First attempt.\n",
      "Retry after reconnect.\n",
    ]);
    expect(driver.getTranscript().entries).toEqual([
      expect.objectContaining({
        order: 1,
        stream: "stdin",
        inputType: "research_prompt",
        text: "First attempt.\n",
      }),
      expect.objectContaining({
        order: 2,
        stream: "stdin",
        inputType: "control",
        text: "Retry after reconnect.\n",
      }),
      expect.objectContaining({
        order: 3,
        stream: "stdout",
        text: "terminal recovered\n",
      }),
      expect.objectContaining({
        order: 4,
        stream: "stderr",
        text: "warning: replayed prompt\n",
      }),
    ]);
  });

  it("captures streamed terminal proposal output that can be extracted after the session exits", async () => {
    const session = new FakeInteractiveSession();
    let tick = 0;

    const driver = new CodexCliSessionDriver("session-004", session, {
      now: () => new Date(Date.UTC(2026, 3, 12, 0, 2, tick++)),
    });

    const resultPromise = driver.run({
      researchPrompt: "Drive the next research cycle and emit a terminal proposal result.",
    });

    session.stdout.write("Cycle complete.\n");
    session.stdout.write(`${CODEX_CLI_SESSION_OUTCOME_BEGIN_MARKER}\n`);
    session.stdout.write(
      JSON.stringify({
        type: "proposal_result",
        reasonCode: "proposal_ready",
        summary: "Produced the next holdout bundle.",
        changedPaths: [
          "reports/holdout-top3.md",
          "artifacts/holdout-top3.json",
        ],
        verificationArtifactPaths: [
          "artifacts/holdout-top3.json",
        ],
      }),
    );
    session.stdout.write(`\n${CODEX_CLI_SESSION_OUTCOME_END_MARKER}\n`);
    session.finish(0, null);

    const result = await resultPromise;

    expect(extractCodexCliSessionOutcome(result.transcript)).toEqual({
      type: "proposal_result",
      reasonCode: "proposal_ready",
      summary: "Produced the next holdout bundle.",
      changedPaths: [
        "reports/holdout-top3.md",
        "artifacts/holdout-top3.json",
      ],
      verificationArtifactPaths: [
        "artifacts/holdout-top3.json",
      ],
    });
  });
});

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error("Condition was not met before timeout");
}
