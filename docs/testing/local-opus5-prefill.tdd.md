# Local Opus 5 prefill compatibility — TDD evidence

## Source and user journey

No external plan file was supplied. The journey was derived from the local
service request:

> As a Claude Code user routed through cc-switch and copilot-api, I want
> `claude-opus-5` requests that contain an assistant prefill to remain valid, so
> the local proxy continues serving requests after GitHub enables the model.

The implementation starts from official `ericc-ch/copilot-api` `v0.7.0`
(`0ea08febdd7e3e055b03dd298bf57e669500b5c1`) and incorporates the behavior
proposed by upstream PR #261, with an additional dated-model normalization
guard found during local review.

## RED/GREEN evidence

| Guarantee | Test/command | Type | Result | Evidence |
|---|---|---|---|---|
| Official v0.7.0 reproduces the trailing assistant prefill defect | `bun test tests/anthropic-request.test.ts` at `f38fe7e^` with the test file from `f38fe7e` | Regression | RED | 20 passed, 2 failed; final role was `assistant`, expected `user` |
| Text and empty prefills are rewritten, while a trailing tool call remains intact | `bun test tests/anthropic-request.test.ts` | Unit/integration translation | PASS | 28 passed, 0 failed |
| `claude-opus-5` is unchanged, dashed minor IDs are dotted, and dated IDs are not corrupted | `bun test tests/anthropic-request.test.ts` | Unit/integration translation | RED then PASS | Dated-ID tests failed at `58efcdf`, then passed after `bd7ed2f` |
| No translation/response regressions exist in the repository suite | `bun test` | Regression | PASS | 35 passed, 0 failed |
| TypeScript contracts remain valid | `bun x --bun tsc --noEmit` | Static | PASS | Exit 0 |
| Changed source and tests meet lint rules | `bun x --bun eslint --cache src/routes/messages/non-stream-translation.ts tests/anthropic-request.test.ts` | Static | PASS | Exit 0 |
| The production artifact builds | `/opt/codex-desktop/resources/node-runtime/bin/node node_modules/tsdown/dist/run.mjs` | Build | PASS | `dist/main.js` SHA-256 `cf73067276e2711df1502486c592e96cd8b968243edd121a21f6af215ea20b29` |
| The restarted service exposes Opus 5 and continues handling requests | systemd status, `GET /`, `GET /v1/models`, and journal inspection | Operational | PASS | New PID `696958`; service active/enabled; Opus 5 present; post-restart request returned HTTP 200 |

## Checkpoints

- `f38fe7e` — RED prefill regression tests
- `a1fcc78` — GREEN upstream prefill rewrite
- `58efcdf` — RED Opus 5/date/tool-call review tests
- `bd7ed2f` — GREEN dated-model guard

Two-axis Codex review was rerun after the review fixes and returned CLEAN for
both Standards and Spec.

## Coverage and known gap

`bun test --coverage` passes all 35 tests and reports 77.06% line coverage and
69.11% function coverage for the repository's current three-test suite. This is
below the generic 80% project-wide target because unrelated error/response
translation paths remain uncovered. The changed prefill branches, exact Opus 5
mapping, dashed/dotted variants, dated variants, and full tool-call exception
are covered explicitly. No project coverage threshold is configured.
