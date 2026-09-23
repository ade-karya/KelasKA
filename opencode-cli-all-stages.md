# OpenCode CLI as the backend for every stage (v2 study)

Status: **study + verified plumbing**. The harness re-architecture below is
proposed, not built.

Scope: `anomalyco/opencode` branch `v2` (installed binary `opencode v2.0.15`,
the latest v2 release tag). Goal: use the local `opencode` CLI as the model
*and* agent backend for every OpenMAIC stage, including the Pro workbench
agent that builds classrooms.

## 1. What the CLI is, and what it is not

`opencode run` is an **agent**, not a model server. It owns its loop, executes
its own tools, and prints an event stream:

```
opencode run --format json [--standalone] [--print-logs] --model <provider/model> <prompt>
```

Two consequences, both verified:

- **It never returns tool calls to the caller.** Tool definitions passed to it
  are dropped. So the pi loop in `lib/agent/runtime/stream-fn.ts` can never see
  a tool call from this transport — the current "text-only" limitation.
- **It executes tools itself.** Built-ins (`read`, `write`, `edit`, `shell`,
  `grep`, `glob`, `execute`, …) plus **MCP servers** it loads from its config.

Therefore "use the CLI in all stages" means: for tool-using stages the CLI must
be the harness (its loop), with OpenMAIC's tools exposed to it over MCP.

## 2. Verified mechanism (proof)

Round trip proven with a probe MCP server:

1. Per-run config injection works via **`OPENCODE_CONFIG_DIR`** (a private
   directory containing `opencode.json`). `OPENCODE_CONFIG` (a file path) is
   ignored; the global `~/.config/opencode/opencode.json` also works but must
   never be touched by the app.
2. MCP servers are declared as `mcp.<name>` = local stdio server:
   `{ "type": "local", "command": ["node", "…"], "enabled": true }`.
3. **MCP tools are reached through Code Mode**, not as first-class tools, in
   this build: the agent calls
   `execute` → `await tools.<server>.<tool>({…})`. `search({query})` finds them
   in the catalog; `codemode: false` (direct exposure) exists only on the v2
   branch head, **not** in the released 2.0.15 build.
4. **`--standalone` is required** for per-run config: MCP servers are loaded by
   the CLI's *server*, and without `--standalone` the run attaches to the shared
   background service, whose config is not the one we injected. Verified: the
   same run without `--standalone` saw zero MCP tools.
5. The CLI reports its tool calls on stdout as
   `{"type":"tool_use","part":{"id","tool","state":{"status","input","output"}}}`.

Implemented and tested in `lib/ai/opencode-cli.ts`:

- `OpencodeMcpServer` + `buildOpencodeConfigJson` + `prepareOpencodeConfigDir`
  (private temp config dir, cleaned up per run),
- `RunOpencodeOptions.mcpServers`, `--standalone` when set,
- `OpencodeToolCall` folding and `{kind:'tool'}` stream events,
- `OPENCODE_CONFIG_DIR` is never inherited from the operator's environment.

Verified end to end: `runOpencodePrompt({ mcpServers: [...] })` produced
`toolCalls: [{ name: 'execute', input: { code: 'return await tools.openmaic.echo_probe({…})' }, output: 'echo:plumbing-ok' }]`
and the probe server logged the call.

## 3. Findings that constrain the design

- **Rate limits**: free-tier limits are per model (`provider.quota`, HTTP 429).
  `muse-spark-*`, `mimo-*`, `ling-*`, `big-pickle` were 429 while
  `nemotron-3.5-lightning-free` / `nemotron-3-ultra-free` served. Retries with
  backoff are already in the transport.
- **The CLI's built-ins act on the process working directory.** A session run
  wrote `proses-fotosintesis-kelas.md` into the repo root. A harness must run
  the CLI with a scratch `cwd` and disable built-ins it does not need.
- **Streaming granularity**: `--format json` emits `text` deltas plus `tool_use`
  events; there is no per-token thinking channel without `--thinking`.
- **No local HTTP/model endpoint**: the CLI cannot serve an OpenAI-compatible
  endpoint, so it cannot be dropped in as a *provider* for tool-using stages.
- **Crash/steer semantics**: the CLI run is a single process per prompt. The
  runner's durable-event, steer, repair and lease discipline does not apply
  inside it; a CLI-native harness must re-derive settlement from CLI events.

## 4. Proposed architecture: CLI-native harness

Add a second harness behind the existing driver seam
(`resolveAgentDriverModel` → `isOpencodeDriverModel`):

```
runner.runSession()
  └─ driver.providerId === 'opencode'
       ├─ build the run's toolset (existing: dslTools, curriculum, ask_user, …)
       ├─ start an MCP bridge exposing exactly that toolset for this session
       ├─ spawn: opencode run --standalone --format json --model <route>
       │         OPENCODE_CONFIG_DIR=<private dir>   (mcp.openmaic → bridge)
       ├─ stream events → LIFECYCLE (text deltas, tool_use cards, terminal)
       └─ settle the session exactly like today (same store, same fencing)
```

Bridge options:

- **A. In-process HTTP MCP route** (`app/api/mcp/[token]/route.ts`, Streamable
  HTTP). The route looks the token up in an in-process registry that the runner
  populates with the run's assembled tools. Lowest latency, no child process,
  full access to the existing owner-scoped stores and lease assertions.
- **B. Local stdio bridge** (`scripts/opencode-mcp-bridge.mjs`) that proxies to
  the app over HTTP. One extra process per run; needs an HTTP surface for every
  tool.

A is preferred: the tools already exist as in-process objects, and the MCP
route runs in the same Node process as the runner.

Tool naming: the CLI namespaces MCP tools by server, so the agent sees
`tools.openmaic["create_stage"]`, `tools.openmaic["generate_scene"]`, … The
system prompt must say to call them through `execute` on this build.

Transcript: map `tool_use` events to the workbench's tool cards
(`ChatNode.kind === 'tool'`, `toolState`, `toolResultText`), and keep the pi
event names for replay compatibility.

## 5. Work plan

1. **MCP route + registry** — token-authenticated, owner/session scoped, exposes
   the run's tools with JSON Schemas from the existing pi tool parameters.
2. **CLI harness module** — `lib/server/agent-runtime/opencode-harness.ts`:
   build config, spawn through `streamOpencodePrompt`, translate events to
   `LIFECYCLE` frames, settle the session.
3. **Runner branch** — `runSession` picks the harness when the driver is
   `opencode`; everything else (lease, heartbeat, cancel, requeue) stays.
4. **Scratch working directory + tool lockdown** — private `cwd`, and a config
   `permission`/`tools` block that disables `edit`/`write`/`shell` so the model
   cannot touch the app's filesystem.
5. **Prompt** — teach the Code Mode call shape
   (`execute` → `tools.openmaic["<tool>"](input)`) and the course workflow.
6. **Tests** — event mapping, tool round trip against the in-process registry,
   settlement/fencing parity with the pi harness.
7. **Optional upgrade path** — once a build with `codemode: false` ships, flip
   it so tools are first-class and the prompt no longer needs the Code Mode
   indirection.

## 6. Fallbacks while the harness is unbuilt

- Text-only stages (scene content, outlines, quizzes, chat) already run on the
  CLI today; the transport now retries rate limits and reports the real cause.
- The classic generator (Pro mode off) builds a classroom without tool calls,
  so it works with the CLI as-is.
- A keyed, tool-capable provider (`MODEL_ROUTES` + `<PROVIDER>_API_KEY`, e.g.
  `openai:gpt-5.4-mini` with `api: openai-completions`) keeps the pi harness
  and needs no new code.
