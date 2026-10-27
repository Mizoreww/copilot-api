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

### Design Rationale

- Measured on Copilot Business with `claude-opus-5.5`: `/v1/messages` with
  `thinking: {type: "adaptive"}` returned 12 / 79 / 241 thinking tokens for
  effort low / high / max; `/chat/completions` returned 81 / 82 / 81 completion
  tokens for `reasoning_effort` low / high / unset, so effort has no effect on
  the translation path.
- `/responses` rejects Claude models (`unsupported_api_for_model`).
- `/v1/messages` accepts both `claude-opus-5.5` and `claude-opus-5-5`, and
  dated IDs, so no model-name rewriting is applied on this path.

### Notes & Caveats

- `thinking: {type: "enabled", budget_tokens}` is rejected by Opus 5.5 with
  HTTP 400; clients must send `adaptive` plus `output_config.effort`.
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
