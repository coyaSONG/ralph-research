import type { CodexCliSessionExit } from "./codex-cli-session-manager.js";

export type CodexCliTranscriptStream = "stdin" | "stdout" | "stderr";
export type CodexCliTranscriptInputType = "research_prompt" | "control";

export interface CodexCliInteractiveSession {
  pid: number | undefined;
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  waitForExit(): Promise<CodexCliSessionExit>;
  stop(signal?: NodeJS.Signals): Promise<CodexCliSessionExit>;
}

export interface CodexCliSessionTranscriptEntry {
  order: number;
  capturedAt: string;
  stream: CodexCliTranscriptStream;
  text: string;
  inputType?: CodexCliTranscriptInputType;
  label?: string;
}

export interface CodexCliSessionTranscript {
  sessionId: string;
  pid: number | undefined;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  exit?: CodexCliSessionExit;
  entries: CodexCliSessionTranscriptEntry[];
}

export interface CodexCliControlInput {
  text: string;
  label?: string;
  appendNewline?: boolean;
}

export interface CodexCliDriveSessionOptions {
  researchPrompt: string;
  controlInputs?: Array<string | CodexCliControlInput>;
}

export interface CodexCliSessionDriverDependencies {
  now?: () => Date;
}

export class CodexCliSessionDriver {
  private readonly now: () => Date;
  private readonly transcript: CodexCliSessionTranscript;
  private readonly detachOutputListeners: () => void;

  private nextOrder = 1;
  private pendingInput: Promise<void> = Promise.resolve();
  private finalizedExit: Promise<CodexCliSessionExit> | null = null;

  public constructor(
    private readonly sessionId: string,
    private readonly session: CodexCliInteractiveSession,
    dependencies: CodexCliSessionDriverDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());

    const startedAt = this.now().toISOString();
    this.transcript = {
      sessionId,
      pid: session.pid,
      startedAt,
      updatedAt: startedAt,
      entries: [],
    };
    this.detachOutputListeners = this.attachOutputListeners();
  }

  public async run(options: CodexCliDriveSessionOptions): Promise<{
    exit: CodexCliSessionExit;
    transcript: CodexCliSessionTranscript;
  }> {
    await this.sendResearchPrompt(options.researchPrompt);
    for (const input of options.controlInputs ?? []) {
      await this.sendControlInput(input);
    }

    const exit = await this.waitForExit();

    return {
      exit,
      transcript: this.getTranscript(),
    };
  }

  public async sendResearchPrompt(prompt: string): Promise<void> {
    const normalized = normalizeRequiredText(prompt, "Research prompt");
    await this.enqueueInput(async () => {
      const payload = withTrailingNewline(normalized);
      this.recordEntry({
        stream: "stdin",
        text: payload,
        inputType: "research_prompt",
      });
      await writeToStream(this.session.stdin, payload);
    });
  }

  public async sendControlInput(input: string | CodexCliControlInput): Promise<void> {
    const control = normalizeControlInput(input);
    await this.enqueueInput(async () => {
      const payload = control.appendNewline ? withTrailingNewline(control.text) : control.text;
      this.recordEntry({
        stream: "stdin",
        text: payload,
        inputType: "control",
        ...(control.label ? { label: control.label } : {}),
      });
      await writeToStream(this.session.stdin, payload);
    });
  }

  public async waitForExit(): Promise<CodexCliSessionExit> {
    return this.finalizeExit(this.session.waitForExit());
  }

  public async stop(signal?: NodeJS.Signals): Promise<CodexCliSessionExit> {
    return this.finalizeExit(this.session.stop(signal));
  }

  public getTranscript(): CodexCliSessionTranscript {
    return {
      ...this.transcript,
      entries: this.transcript.entries.map((entry) => ({ ...entry })),
    };
  }

  private attachOutputListeners(): () => void {
    const onStdout = (chunk: unknown): void => {
      this.recordEntry({
        stream: "stdout",
        text: toUtf8(chunk),
      });
    };
    const onStderr = (chunk: unknown): void => {
      this.recordEntry({
        stream: "stderr",
        text: toUtf8(chunk),
      });
    };

    this.session.stdout.on("data", onStdout);
    this.session.stderr.on("data", onStderr);

    return () => {
      this.session.stdout.off("data", onStdout);
      this.session.stderr.off("data", onStderr);
    };
  }

  private recordEntry(entry: Omit<CodexCliSessionTranscriptEntry, "order" | "capturedAt">): void {
    const capturedAt = this.now().toISOString();
    this.transcript.entries.push({
      order: this.nextOrder,
      capturedAt,
      ...entry,
    });
    this.nextOrder += 1;
    this.transcript.updatedAt = capturedAt;
  }

  private enqueueInput(operation: () => Promise<void>): Promise<void> {
    const next = this.pendingInput.then(operation);
    this.pendingInput = next.catch(() => undefined);
    return next;
  }

  private async finalizeExit(exitPromise: Promise<CodexCliSessionExit>): Promise<CodexCliSessionExit> {
    if (!this.finalizedExit) {
      this.finalizedExit = exitPromise.then((exit) => {
        this.detachOutputListeners();
        const endedAt = this.now().toISOString();
        this.transcript.endedAt = endedAt;
        this.transcript.updatedAt = endedAt;
        this.transcript.exit = exit;
        return exit;
      });
    }

    return this.finalizedExit;
  }
}

async function writeToStream(stream: NodeJS.WritableStream, value: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const writable = asWritable(stream);
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      writable.off("error", onError);
      writable.off("drain", onDrain);
    };

    writable.on("error", onError);
    const accepted = writable.write(value, "utf8");
    if (accepted) {
      cleanup();
      resolve();
      return;
    }

    writable.once("drain", onDrain);
  });
}

function normalizeControlInput(input: string | CodexCliControlInput): Required<CodexCliControlInput> {
  if (typeof input === "string") {
    return {
      text: normalizeRequiredText(input, "Control input"),
      label: "",
      appendNewline: true,
    };
  }

  return {
    text: normalizeRequiredText(input.text, "Control input"),
    label: input.label?.trim() ?? "",
    appendNewline: input.appendNewline ?? true,
  };
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function toUtf8(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }

  return String(chunk);
}

function asWritable(
  stream: NodeJS.WritableStream,
): NodeJS.WritableStream & {
  on(event: "error", listener: (error: Error) => void): unknown;
  off(event: "error" | "drain", listener: (...args: never[]) => void): unknown;
  once(event: "drain", listener: () => void): unknown;
  write(chunk: string, encoding: BufferEncoding): boolean;
} {
  return stream as NodeJS.WritableStream & {
    on(event: "error", listener: (error: Error) => void): unknown;
    off(event: "error" | "drain", listener: (...args: never[]) => void): unknown;
    once(event: "drain", listener: () => void): unknown;
    write(chunk: string, encoding: BufferEncoding): boolean;
  };
}
