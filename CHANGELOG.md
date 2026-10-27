# Changelog

## [0.7.0-mizore.2] - 2026-10-27

### Features

- `/v1/messages` requests for `claude*` models are forwarded unchanged to
  Copilot's native Anthropic endpoint `/v1/messages` instead of being
  translated to `/chat/completions`. Model name, `thinking`,
  `output_config.effort`, `cache_control`, `anthropic-beta` and
  `anthropic-version` now reach Copilot.
- Upstream errors on this path are returned with their original status, body
  and `retry-after` header.
- Set `COPILOT_NATIVE_MESSAGES=0` to restore the translation path.
- When Copilot rejects the request's `thinking.type` with HTTP 400, the
  request is retried once with the type named in the error message, and the
  rewrite is remembered per upstream model for later requests:
  `enabled` becomes `adaptive`; `disabled` becomes the suggested type
  (`between_tools` on Sonnet 5.5), or `adaptive` with effort `low` when the
  model has no way to turn thinking off (Opus 5.5).

### Design Rationale

- Measured on Copilot Business with `claude-opus-5.5`: `/v1/messages` with
  `thinking: {type: "adaptive"}` returned 12 / 79 / 241 thinking tokens for
  effort low / high / max; `/chat/completions` returned 81 / 82 / 81 completion
  tokens for `reasoning_effort` low / high / unset, so effort has no effect on
  the translation path.
- `/responses` rejects Claude models (`unsupported_api_for_model`).
- `/v1/messages` accepts both `claude-opus-5.5` and `claude-opus-5-5`, and
  dated IDs, so no model-name rewriting is applied on this path.
- Clients pick the thinking type from the model ID they know. Routers such as
  cc-switch map Claude Desktop IDs (`claude-fable-5`, `claude-opus-5`,
  `claude-sonnet-5`, `claude-haiku-4-5`) to `claude-opus-5-5` or
  `claude-sonnet-5-5`, whose rules differ. Accepted thinking types measured on
  2026-10-27: Opus 5.5 accepts omitted and `adaptive`; Sonnet 5.5 accepts
  omitted, `adaptive` and `between_tools`; Haiku 5.5 accepts omitted,
  `adaptive` and `disabled`. All three reject `enabled`. The rewrite follows
  the upstream error text instead of a fixed model table.

### Notes & Caveats

- `thinking: {type: "enabled", budget_tokens}` is rejected by Opus 5.5 with
  HTTP 400; the retry above converts it to `adaptive`.
- The first request per model and thinking type still costs one rejected
  upstream call before the rewrite is remembered; the cache is in memory and
  is cleared on restart.
- A client that maps `claude-haiku-4-5` to an Opus model sends no
  `output_config.effort`, so the client's effort setting has no effect there.
- Non-Claude models and `/v1/messages/count_tokens` still use the translation
  path.
- Whether Copilot counts premium requests differently on `/v1/messages` has not
  been verified.

## [0.7.0-mizore.1] - 2026-07-29

### Features

- Added a maintained compatibility baseline for direct Claude Code usage with
  GitHub Copilot Business.
- Documented the tested direct-mode configuration for Claude Opus 5.

### Design Rationale

- Preserve upstream `v0.7.0` behavior while carrying only the compatibility and
  reliability fixes required by current clients.
- Keep the fork installable from source without publishing or claiming ownership
  of the upstream npm package.

### Fixes

- Rewrite unsupported trailing assistant prefills before forwarding requests.
- Keep exact Opus 5 IDs unchanged, convert dashed minor versions to Copilot's
  dotted form, and reduce dated IDs to their supported base model.
- Raise Bun's streaming idle timeout from its 10-second default to 255 seconds.

### Notes & Caveats

- This project reverse-engineers GitHub Copilot endpoints and is not supported
  by GitHub.
- GitHub may change model availability or request contracts without notice.
- Use responsibly and comply with GitHub's terms and acceptable-use policies.
