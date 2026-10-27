import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { server } from "~/server"
import {
  createAnthropicMessages,
  shouldUseNativeMessages,
  toClientResponse,
  type NativeMessagesPayload,
} from "~/services/copilot/create-anthropic-messages"

const OPUS_DISABLED_REJECTED =
  '"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.'

interface FetchInit {
  headers: Record<string, string>
  body: string
}

const realFetch = globalThis.fetch
let calls: Array<{ url: string; init: FetchInit }> = []

function mockFetch(...responses: Array<Response>): void {
  calls = []
  const fetchMock = mock((url: string, init: FetchInit) => {
    calls.push({ url, init })
    return Promise.resolve(responses[calls.length - 1])
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function thinkingError(message: string): Response {
  return jsonResponse(
    { type: "error", error: { type: "invalid_request_error", message } },
    400,
  )
}

function sentBody(index: number): NativeMessagesPayload {
  return JSON.parse(calls[index].init.body) as NativeMessagesPayload
}

function payload(model: string, thinkingType: string): NativeMessagesPayload {
  return {
    model,
    max_tokens: 16,
    messages: [{ role: "user", content: "hi" }],
    thinking: { type: thinkingType },
    output_config: { effort: "high" },
  }
}

beforeEach(() => {
  state.copilotToken = "test-token"
  state.vsCodeVersion = "1.0.0"
  state.accountType = "individual"
  state.nativeMessages = true
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("createAnthropicMessages", () => {
  test("forwards model, thinking, effort and beta headers unchanged", async () => {
    mockFetch(jsonResponse({ type: "message" }))
    await createAnthropicMessages(
      payload("claude-opus-5-5", "adaptive"),
      new Headers({ "anthropic-beta": "context-1m-2025-08-07" }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://api.githubcopilot.com/v1/messages")
    expect(sentBody(0)).toEqual(payload("claude-opus-5-5", "adaptive"))
    expect(calls[0].init.headers["anthropic-beta"]).toBe(
      "context-1m-2025-08-07",
    )
    expect(calls[0].init.headers["X-Initiator"]).toBe("user")
  })

  test("retries once with the accepted type and caches it after success", async () => {
    mockFetch(
      thinkingError(OPUS_DISABLED_REJECTED),
      jsonResponse({ type: "message" }),
      jsonResponse({ type: "message" }),
    )
    await createAnthropicMessages(
      payload("model-retry", "disabled"),
      new Headers(),
    )
    expect(calls).toHaveLength(2)
    expect(sentBody(1).thinking).toEqual({ type: "adaptive" })
    expect(sentBody(1).output_config).toEqual({ effort: "high" })

    await createAnthropicMessages(
      payload("model-retry", "disabled"),
      new Headers(),
    )
    expect(calls).toHaveLength(3)
    expect(sentBody(2).thinking).toEqual({ type: "adaptive" })
  })

  test("does not cache the accepted type when the retry fails", async () => {
    mockFetch(
      thinkingError(OPUS_DISABLED_REJECTED),
      thinkingError("Another problem."),
      thinkingError(OPUS_DISABLED_REJECTED),
      jsonResponse({ type: "message" }),
    )
    const failed = await createAnthropicMessages(
      payload("model-no-cache", "disabled"),
      new Headers(),
    ).catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(HTTPError)

    await createAnthropicMessages(
      payload("model-no-cache", "disabled"),
      new Headers(),
    )
    expect(calls).toHaveLength(4)
    expect(sentBody(2).thinking).toEqual({ type: "disabled" })
  })

  test("returns other errors without a retry", async () => {
    mockFetch(
      new Response('{"type":"error"}', {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "7" },
      }),
    )
    const failed = await createAnthropicMessages(
      payload("model-429", "disabled"),
      new Headers(),
    ).catch((error: unknown) => error)
    expect(calls).toHaveLength(1)
    if (!(failed instanceof HTTPError)) throw new Error("expected HTTPError")
    const response = toClientResponse(failed.response)
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("7")
    expect(await response.text()).toBe('{"type":"error"}')
  })

  test("marks agent calls and images inside tool results", async () => {
    mockFetch(jsonResponse({ type: "message" }))
    await createAnthropicMessages(
      {
        model: "claude-opus-5-5",
        messages: [
          { role: "user", content: "Read a.png." },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                content: [{ type: "image", source: {} }],
              },
            ],
          },
        ],
      },
      new Headers(),
    )
    expect(calls[0].init.headers["X-Initiator"]).toBe("agent")
    expect(calls[0].init.headers["copilot-vision-request"]).toBe("true")
  })
})

describe("shouldUseNativeMessages", () => {
  const userTurn = [{ role: "user" }]

  test("selects Claude models", () => {
    expect(
      shouldUseNativeMessages({ model: "claude-opus-5", messages: userTurn }),
    ).toBe(true)
    expect(
      shouldUseNativeMessages({ model: "gpt-4.1", messages: userTurn }),
    ).toBe(false)
  })

  test("keeps the translation path for a trailing assistant prefill", () => {
    expect(
      shouldUseNativeMessages({
        model: "claude-opus-5",
        messages: [...userTurn, { role: "assistant" }],
      }),
    ).toBe(false)
  })

  test("follows the native-messages option", () => {
    state.nativeMessages = false
    expect(
      shouldUseNativeMessages({ model: "claude-opus-5", messages: userTurn }),
    ).toBe(false)
  })
})

describe("POST /v1/messages", () => {
  test("streams the native response to the client unchanged", async () => {
    const events = 'event: message_start\ndata: {"type":"message_start"}\n\n'
    mockFetch(
      new Response(events, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    )
    const body = { ...payload("claude-opus-5", "adaptive"), stream: true }
    const response = await server.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    expect(calls[0].url).toEndWith("/v1/messages")
    expect(sentBody(0)).toEqual(body)
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(await response.text()).toBe(events)
  })

  test("sends other models through /chat/completions", async () => {
    mockFetch(
      jsonResponse({
        id: "1",
        object: "chat.completion",
        created: 0,
        model: "gpt-4.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hi" },
            logprobs: null,
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    )
    const response = await server.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    })
    expect(calls[0].url).toEndWith("/chat/completions")
    expect(response.status).toBe(200)
  })
})
