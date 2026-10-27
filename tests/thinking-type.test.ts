import { beforeEach, describe, expect, test } from "bun:test"

import {
  acceptedThinkingTypes,
  thinkingRejection,
} from "~/services/copilot/thinking-type"

import {
  BETWEEN_TOOLS_REJECTED,
  ENABLED_REJECTED,
  errorBody,
  OPUS_DISABLED_REJECTED,
  SONNET_DISABLED_REJECTED,
} from "./fixtures/thinking-errors"

describe("thinkingRejection", () => {
  test("reads the rejected type and the type that follows Use", () => {
    expect(thinkingRejection(ENABLED_REJECTED)).toEqual({
      rejected: "enabled",
      accepted: "adaptive",
    })
    expect(thinkingRejection(OPUS_DISABLED_REJECTED)).toEqual({
      rejected: "disabled",
      accepted: "adaptive",
    })
  })

  test("reads the replacement type", () => {
    expect(thinkingRejection(SONNET_DISABLED_REJECTED)).toEqual({
      rejected: "disabled",
      accepted: "between_tools",
    })
  })

  test("reads the message from an Anthropic error body", () => {
    expect(thinkingRejection(errorBody(OPUS_DISABLED_REJECTED))).toEqual({
      rejected: "disabled",
      accepted: "adaptive",
    })
  })

  test("returns no accepted type when the error names none", () => {
    expect(thinkingRejection(BETWEEN_TOOLS_REJECTED)).toEqual({
      rejected: "between_tools",
      accepted: undefined,
    })
  })

  test("returns nothing for other errors", () => {
    expect(
      thinkingRejection("The requested model is not supported."),
    ).toBeUndefined()
  })
})

describe("acceptedThinkingTypes", () => {
  beforeEach(() => {
    acceptedThinkingTypes.clear()
  })

  test("keeps one accepted type per model and requested type", () => {
    acceptedThinkingTypes.set("claude-opus-5-5", "disabled", "adaptive")
    acceptedThinkingTypes.set("claude-sonnet-5-5", "disabled", "between_tools")
    expect(acceptedThinkingTypes.get("claude-opus-5-5", "disabled")).toBe(
      "adaptive",
    )
    expect(acceptedThinkingTypes.get("claude-sonnet-5-5", "disabled")).toBe(
      "between_tools",
    )
    expect(
      acceptedThinkingTypes.get("claude-opus-5-5", "enabled"),
    ).toBeUndefined()

    acceptedThinkingTypes.delete("claude-opus-5-5", "disabled")
    expect(
      acceptedThinkingTypes.get("claude-opus-5-5", "disabled"),
    ).toBeUndefined()
  })
})
