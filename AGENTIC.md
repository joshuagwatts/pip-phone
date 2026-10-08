# PIP Agentic Core — design notes

Branch `agentic-core` (off phase1-memory c144b192). Turns PIP from a chatbot into a
tool-using agent. Local and free: desktop Ollama → on-device Qwen → paired desktop →
cloud only with explicit per-run consent.

## Files

- `www/agent.js` — ReAct loop. `runAgent(goal, ctx)` picks a backend, loops up to
  12 steps: model emits tool calls → tools execute → results fed back → final answer
  in Pip's voice. Never throws — max steps / backend errors degrade to a graceful
  "here's how far I got" summary. `runAgentLoop(goal, ctx, backend)` is exported
  separately so tests can inject a mock backend.
- `www/tools.js` — tool registry. Each tool = { name, description, schema, lane, run }.
  `execTool` enforces lanes + approval rails + the append-only run log
  (`pip.agent.runs.v1` in localStorage — seeds the blueprint's consent ledger).
  Also: `calcEval` (safe math parser, no eval), `scheduleReminder`/`dueReminders`,
  `parseWhen`, `getRunLog`.
- `www/ollama.js` — native Ollama client (localhost:11434 only; bypasses net.js
  asserts deliberately). `pickOllamaModel()` checks /api/show capabilities for
  "tools". Native `tools` param on /api/chat.
- `www/shell.js` — renderer side of the shell bridge. Reports unavailable with an
  honest message off-desktop.
- `desktop/preload.js` — contextBridge exposing ONE function: `pipShell.exec(cmd, timeoutMs)`.
  OS shell, 60s default (1s–120s clamp), 64KB output cap, 4000-char command cap.
- `desktop/main.js` — wires the preload into webPreferences.
- `www/app.js` — `/agent <goal>` command (additive; normal chat untouched),
  `agentApprove()` inline one-tap approval card, reminder surfacing on the 20s tick.
- `www/style.css` — approval card styles.

## Backends (in order)

1. **ollama** — desktop Electron + tool-capable model → native `tools` param. Fast path.
2. **qwen** — on-device Qwen via `ensurePip()` (RAW `eng.complete`, not `localComplete` —
   `sanitizeReply` would strip the tool blocks). Strict in-prompt JSON protocol:
   `<tool name="x"> {...} </tool>` fenced blocks, parsed by regex.
3. **companion** — paired desktop's text `/api/chat`, same JSON protocol serialized into text.
4. **cloud** — `cloudCompleteTools` (native tools, already wired in cloud.js), only when
   keyed providers exist AND (LEAKY mode OR explicit per-run approval in SECURE).

## Tool-call protocol (non-native backends)

System prompt carries the tool manifest as text. The model emits:
```
<tool name="memory_search">
{"query": "roofing deadlines"}
</tool>
```
Parsed with `/<tool\s+name="([a-z0-9_]+)"\s*>([\s\S]*?)<\/tool>/gi`. Results return as
`<result name="...">…</result>` user messages (native backends use proper tool roles).

## Shell jail / allowlist design

No binary allowlist — the honest rail is approval + logging instead:
- Preload exposes a single `exec`; clamps (timeout 1–120s, 64KB output, 4000-char command).
- Renderer (`tools.js`) requires ONE TAP per session per command-pattern (first token,
  e.g. `git`, `ls`) before the first run; repeats in the session don't ask. The exact
  command is always shown in the approval card.
- Every invocation is appended to the run log with timestamp + full command.
- Off-desktop, `shell` reports "desktop-only" instead of failing weird.
- file_write is jailed by construction: codefs.js strips paths to basenames, so writes
  can only land in the app overlay workspace — never arbitrary disk paths. Still asks
  once per file per session.

## Privacy

- `lane:'network'` (web_fetch): SECURE mode asks once per agent run ("Web access for
  this run?"); LEAKY proceeds. `httpGet` refuses non-public IPs (SSRF-safe).
- `lane:'desktop'` (shell): desktop-only.
- Vault secret fields never enter tool args; memory_search goes through the engine's
  `searchMem` (which never touches the vault).
- Final answers pass through `sanitizeReply` — crew.js voice lock holds.

## Test steps (his)

1. `git fetch origin && git checkout agentic-core && npm install && npx cap sync`
2. Desktop: make sure Ollama is running, then `ollama pull qwen3:4b` (free, ~2.5GB).
   Rebuild the desktop app (preload needs the Electron rebuild) — or `npm run desktop`.
3. In chat: `/agent what do you remember about my roofing work, and remind me in 2 hours to review it`
   - Expect: step narrations ("Checking my memory…", "Setting that reminder…"), one
     approval card only if a shell/file_write/network tool fires, final answer in Pip's voice.
4. `/agent run git status on my desktop` (desktop only) → approval card shows the exact
   command → APPROVE → stdout in the result, final summary in Pip's voice.
5. First run on desktop shows the `ollama pull qwen3:4b` guidance once if no tool-capable
   model is paired.

## What this build does NOT do

- No real Ollama tool-calling verified here (needs his desktop + `ollama pull qwen3:4b`).
- The paired-desktop companion protocol is text-only; native tools there would need the
  companion server (not in this repo) to grow a tools endpoint.
- Reminders surface while the app/tick is alive — no OS-level push while the app is dead.
