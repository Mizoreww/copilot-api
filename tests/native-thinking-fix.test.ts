import { describe, expect, test } from "bun:test"

import {
  thinkingFixFromError,
  type PassthroughPayload,
} from "../src/services/copilot/create-anthropic-messages"

// Error messages returned by Copilot /v1/messages on 2026-10-27.
const OPUS_DISABLED =
  '"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.'
const OPUS_ENABLED =
  '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.'
const SONNET_DISABLED =
  'To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}. The model does not think before responding.'
const BETWEEN_TOOLS =
  '"thinking.type.between_tools" is not supported for this model.'

function payload(
  thinking: PassthroughPayload["thinking"],
  effort?: string,
): PassthroughPayload {
  return {
    model: "claude-opus-5-5",
    messages: [{ role: "user", content: "hi" }],
    thinking,
    ...(effort ? { output_config: { effort } } : {}),
  }
}

describe("thinkingFixFromError", () => {
  test("enabled with budget becomes adaptive and keeps effort", () => {
    const p = payload({ type: "enabled", budget_tokens: 31999 }, "high")
    thinkingFixFromError("enabled", OPUS_ENABLED)?.(p)
    expect(p.thinking).toEqual({ type: "adaptive" })
    expect(p.output_config).toEqual({ effort: "high" })
  })

  test("disabled follows the suggested replacement type", () => {
    const p = payload({ type: "disabled" }, "high")
    thinkingFixFromError("disabled", SONNET_DISABLED)?.(p)
    expect(p.thinking).toEqual({ type: "between_tools" })
    expect(p.output_config).toEqual({ effort: "high" })
  })

  test("disabled without an off switch becomes adaptive at low effort", () => {
    const p = payload({ type: "disabled" }, "high")
    thinkingFixFromError("disabled", OPUS_DISABLED)?.(p)
    expect(p.thinking).toEqual({ type: "adaptive" })
    expect(p.output_config).toEqual({ effort: "low" })
  })

  test("errors without a usable suggestion are not rewritten", () => {
    expect(thinkingFixFromError("between_tools", BETWEEN_TOOLS)).toBeUndefined()
    expect(
      thinkingFixFromError("disabled", "The requested model is not supported."),
    ).toBeUndefined()
    expect(thinkingFixFromError("enabled", OPUS_DISABLED)).toBeUndefined()
  })
})
