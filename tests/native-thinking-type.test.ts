import { describe, expect, test } from "bun:test"

import { acceptedThinkingType } from "~/services/copilot/create-anthropic-messages"

// Error messages returned by Copilot /v1/messages on 2026-10-27.
// Opus 5.5, Sonnet 5.5 and Haiku 5.5 return the same text for "enabled".
const ENABLED_REJECTED =
  '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.'
const OPUS_DISABLED_REJECTED =
  '"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.'
const SONNET_DISABLED_REJECTED =
  'To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}. The model does not think before responding.'
const BETWEEN_TOOLS_REJECTED =
  '"thinking.type.between_tools" is not supported for this model.'

describe("acceptedThinkingType", () => {
  test("reads the type that follows Use", () => {
    expect(acceptedThinkingType(ENABLED_REJECTED, "enabled")).toBe("adaptive")
    expect(acceptedThinkingType(OPUS_DISABLED_REJECTED, "disabled")).toBe(
      "adaptive",
    )
  })

  test("reads the replacement type", () => {
    expect(acceptedThinkingType(SONNET_DISABLED_REJECTED, "disabled")).toBe(
      "between_tools",
    )
  })

  test("returns nothing when the error names no other accepted type", () => {
    expect(
      acceptedThinkingType(BETWEEN_TOOLS_REJECTED, "between_tools"),
    ).toBeUndefined()
    expect(
      acceptedThinkingType(OPUS_DISABLED_REJECTED, "enabled"),
    ).toBeUndefined()
    expect(
      acceptedThinkingType("The requested model is not supported.", "disabled"),
    ).toBeUndefined()
    expect(
      acceptedThinkingType(
        '"thinking.type.adaptive" is not supported. Use "thinking.type.adaptive"',
        "adaptive",
      ),
    ).toBeUndefined()
  })
})
