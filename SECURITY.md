# Security policy

## Supported versions

`ralph-research` is a local-first runtime; there is no hosted service to
patch. The current security-supported line is the latest release on `main`:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

If you depend on a pinned older minor, please open an issue so we can decide
whether to backport. We will not silently backport without that conversation.

## Reporting a vulnerability

Please do **not** file public GitHub issues for security problems. Instead:

1. Open a GitHub security advisory at
   [https://github.com/coyaSONG/ralph-research/security/advisories/new](https://github.com/coyaSONG/ralph-research/security/advisories/new).
2. Include a reproduction, the version of `ralph-research` you tested, your
   Node.js version, and the operating system.
3. If you cannot use GitHub security advisories, contact the maintainer through
   the email address on their GitHub profile.

We will acknowledge receipt within 7 days and aim to ship a fix or a documented
mitigation within 30 days for issues we agree are exploitable.

## Threat model the project explicitly takes responsibility for

- The CLI and MCP server execute commands from the `ralph.yaml` manifest in the
  same Git repository as the runtime. Treating a manifest from an untrusted
  source as safe is **out of scope** — manifests run arbitrary commands by
  design. Always read `ralph.yaml` before running `rrx`.
- Persisted state under `.ralph/` may include LLM judge rationales and
  experiment outputs. Treat that directory with the same care as any other
  build artifact your repository produces.
- The runtime never uploads state or telemetry to a remote service.

## Coordinated disclosure

If you are reporting an issue that also affects upstream dependencies
(`commander`, `execa`, `pino`, `yaml`, `zod`, `@modelcontextprotocol/sdk`),
please disclose to those projects first or at the same time. We will coordinate
release windows where it makes sense.
