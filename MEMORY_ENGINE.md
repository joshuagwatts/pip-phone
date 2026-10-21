# PIP Memory Engine — Phase 1 design notes

The memory system that makes PIP a *safe personal information processor*.
Lives in `www/memory-engine.js` (+ recall, embed, distill, ui modules).

## Tiers

| Tier | Persisted? | How entries get in |
|---|---|---|
| `working` | No — volatile, this session only | Auto-capture of substantive chat lines (heuristic) |
| `daily` | Yes, encrypted | Nightly distillation of the day's captures; migrated archive |
| `durable` | Yes, encrypted | ONLY explicit `/remember`, 📌 promote, or approving a suggestion |
| `people` | Yes, encrypted | Manual add in the MEMORY tab (one page per person) |

## Entry schema (sync-merge-ready from day one)

```js
{ id,            // uuid (crypto.randomUUID)
  tier,          // working|daily|durable|people
  title, content, tags[], role, score,
  created_at, updated_at,          // ISO — last-writer-wins on future merge
  origin,                          // 'phone'|'desktop'
  deleted,                         // tombstone bool — delete never hard-deletes
  migrated,                        // true for round-1 imports
  suggested,                       // true while awaiting his approve/dismiss
  embedding,                       // cached MiniLM vector or null
  pending_action }                  // reserved — verdict Q1 (act AND draft), Phase 4
```

Future encrypted desktop sync merges on `id`: higher `updated_at` wins,
`tombstone` (`deleted:true`) beats any edit. Tombstones are tiny and kept
until a real retention policy ships.

## Encryption at rest (envelope)

- One random 256-bit **DEK** generated at first boot, stored **in the secrets
  vault** (`memory_dek` via `www/secrets.js` — Android Keystore / iOS Keychain
  on native, passphrase-encrypted vault on web). The DEK never touches
  `localStorage`.
- Memory blob `pip.phone.memory.v1` = `{v, iv, data}` where `data` is
  AES-GCM(DEK, JSON(entries)). Fresh IV per save. Working tier is never
  written.
- Boot order: biometric/passphrase gate → vault unlock → DEK → decrypt.
  If crypto fails, boot fails **loudly** — an unencrypted engine would
  silently break the security promise.
- Migration: old plaintext `db.moments` → score ≥ 14 becomes individual
  `durable` entries; the rest grouped by day into `daily` notes. Everything
  kept, marked `migrated:true`. The old list is wiped **after** the encrypted
  write succeeds.

## Recall — honest about what it is

**Baseline (default, always on): scored hybrid.** Token overlap (stopwords
removed, light stemming, title ×3) × recency decay (30-day half-life) × tier
weight (durable 3.0 > people 2.5 > daily 2.0 > working 1.0) × substance score.
Fully offline, zero downloads, beats the old substring search. It is never
labeled "semantic" — because it isn't.

**Smart recall (opt-in toggle in the MEMORY tab): real on-device semantic
search.** Lazy-loads `Xenova/all-MiniLM-L6-v2` (~23MB quantized, one-time
download, browser-cached) through the same transformers.js WASM runtime the
app already uses for on-device Qwen. Vectors are cached per entry inside the
encrypted blob; recall blends cosine similarity at 60% where vectors exist
(similarity floor 0.15 so weak semantic noise can't outrank a strong keyword
hit), hybrid elsewhere. If the download fails, the toggle reports it and
hybrid keeps working. Fully offline once cached.

Why not default-on: a 23MB first-run download on mobile data is rude, and
recall must never break. The hybrid is genuinely good at personal-memory
scale (hundreds of entries, not millions).

## Nightly distillation

- Trigger: existing 5-minute keepalive tick (`background.js`) + once at boot
  (`app.js`) for missed days. At most once per calendar day
  (`settings.memory_distill_last`).
- Model: **local only** — desktop Ollama first, on-device Qwen second, via
  `brain.js:localOnlyComplete()`, which *cannot* reach cloud by construction.
- Output: one dated `daily` note + 0–3 `durable` **suggestions**
  (`suggested:true`). Nothing auto-promotes — the MEMORY tab shows them for
  one-tap REMEMBER IT / NAH.
- No local model reachable → job **queued** (`settings.memory_distill_pending`
  = date), retried next tick. The MEMORY tab shows "waiting for a local
  model" — labeled, never silently skipped.

## Prompt assembly (scope hygiene)

`assembleMemoryContext({query, limit, tiers})` in `memory-engine.js` is the
**only** path memory takes into a prompt (`brain.js:chat()` calls it with the
user's message as the query). Memory entries are user content — vault secret
fields can never appear because assembly never reads the secrets vault.

## Files

- `www/memory-engine.js` — tiers, schema, encryption, CRUD, assembly
- `www/memory-recall.js` — hybrid scoring + vector blending
- `www/memory-embed.js` — lazy MiniLM embeddings (opt-in)
- `www/memory-distill.js` — nightly local-only distillation
- `www/memory-ui.js` — the MEMORY tab
- `www/memory.js` — kept for `chainBrief()` (brain health line); capture
  helpers superseded by the engine

## Test on his PC / phone

Branch: `phase1-memory` (not on main, not pushed).
1. `git checkout phase1-memory && npm install && npx cap sync`
2. Rebuild + install on the phone (or `npx cap run`/Electron for desktop web).
3. First boot: biometric/passphrase gate → DEK generated → old moments
   migrate (MEMORY tab shows counts; old `pip.phone.v1` blob has no `moments`).
4. Chat a few substantive lines → MEMORY tab → WORKING shows captures.
5. `/remember <text>` in chat → entry lands in DURABLE immediately.
6. MEMORY tab → DISTILL NOW (needs desktop Ollama paired or on-device Qwen)
   → dated DAILY note + suggestions appear; approve/dismiss them.
7. Search box: hybrid ranking; toggle SMART RECALL → one-time ~23MB
   download → ✦ badge on indexed entries.
8. DATA tab sanity: API keys still in the vault, chat still answers, SECURE
   behavior unchanged.

## Deliberately NOT in Phase 1

Actions (verdict Q1) — schema reserves `pending_action`, nothing executes.
Crew faces (verdict Q3) — MEMORY tab speaks in Pip's voice. Consent ledger,
briefings, conductor scope tables — Phases 2–3.
