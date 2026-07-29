# Changelog

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
