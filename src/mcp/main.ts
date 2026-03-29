import { startMcpServer } from "./server.js";

void startMcpServer({
  repoRoot: process.cwd(),
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
