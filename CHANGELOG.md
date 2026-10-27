# Changelog

## [0.7.0-mizore.2] - 2026-10-27

### Features

- `/v1/messages` requests for `claude*` models are forwarded unchanged to
  Copilot's native Anthropic endpoint `/v1/messages` instead of being
  translated to `/chat/completions`. Model name, `thinking`,
  `output_config.effort`, `cache_control`, `anthropic-beta` and
  `anthropic-version` now reach Copilot.
- Upstream errors on this path keep their original status and body. The
  `retry-after` and `x-should-retry` headers are forwarded for client retries,
  and `cache-control` for streaming responses.
- `--no-native-messages` restores the translation path for Claude models.
- When Copilot rejects the request's `thinking.type` with HTTP 400, the
  request is retried once with the type that the error names: `enabled` and
  `disabled` become `adaptive` on Opus 5.5, `disabled` becomes `between_tools`
  on Sonnet 5.5. The effort is not changed. The accepted type is cached per
  upstream model after a successful retry, and a cached type that Copilot
  rejects later is dropped and replaced.

### Design Rationale

- Measured on Copilot Business with `claude-opus-5.5`: `/v1/messages` with
  `thinking: {type: "adaptive"}` returned 12 / 79 / 241 thinking tokens for
  effort low / high / max; `/chat/completions` returned 81 / 82 / 81 completion
  tokens for `reasoning_effort` low / high / unset, so effort has no effect on
  the translation path.
- `/responses` rejects Claude models (`unsupported_api_for_model`).
- `/v1/messages` accepts dotted, dashed and dated IDs of the models that
  Copilot offers (for example `claude-opus-5.5`, `claude-opus-4-8`,
  `claude-haiku-4-5-20251001`), so no model-name rewriting is applied on this
  path. It ignores unknown `anthropic-beta` values.
- Clients pick the thinking type from the model ID they know. Routers such as
  cc-switch map Claude Desktop IDs (`claude-fable-5`, `claude-opus-5`,
  `claude-sonnet-5`, `claude-haiku-4-5`) to `claude-opus-5-5` or
  `claude-sonnet-5-5`, whose rules differ. Accepted thinking types measured on
  2026-10-27: Opus 5.5 accepts omitted and `adaptive`; Sonnet 5.5 accepts
  omitted, `adaptive` and `between_tools`; Haiku 5.5 accepts omitted,
  `adaptive` and `disabled`. All three reject `enabled`. The rewrite follows
  the upstream error text instead of a fixed model table.
- Copilot's `/v1/messages` rejects a trailing assistant prefill on Opus 5.5
  and Sonnet 5.5, so these requests keep the translation path and its prefill
  rewrite.
- Billing: both endpoints return a `copilot_usage` object with the same
  `claude-opus-5.5` price table (per 1M tokens: input 400, output 2000,
  cache read 20, cache write 500 AI credits). For the same
  prompt of about 94k tokens, `/chat/completions` reported 46.94 AI credits
  because Copilot billed the prompt as a cache write, and `/v1/messages`
  reported 37.53 AI credits as plain input. The usage counter matched the
  `/v1/messages` value (75 credits for two requests) but showed 239 credits for
  two `/chat/completions` requests. The cause of that difference has not been
  determined.

### Notes & Caveats

- The first request per model and thinking type still costs one rejected
  upstream call before the accepted type is cached; the cache is in memory and
  is cleared on restart.
- A client that maps `claude-haiku-4-5` to an Opus model sends no
  `output_config.effort`, so the client's effort setting has no effect there.
- Non-Claude models, `/v1/messages/count_tokens` and requests that end with an
  assistant message still use the translation path.
- The usage counter reports charges with a delay of one to more than ten
  minutes, so per-request billing cannot be read right after a request.

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
