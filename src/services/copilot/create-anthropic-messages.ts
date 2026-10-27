import consola from "consola"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

// Forwards Anthropic Messages requests unchanged to Copilot's native
// /v1/messages endpoint. The /chat/completions translation drops `thinking`
// and `output_config.effort`.

interface NativeMessage {
  role: string
  content: unknown
}

export interface NativeMessagesPayload {
  model: string
  messages: Array<NativeMessage>
  thinking?: { type?: string; display?: string; [key: string]: unknown }
  output_config?: { effort?: string; [key: string]: unknown }
  [key: string]: unknown
}

const FORWARDED_REQUEST_HEADERS = ["anthropic-version", "anthropic-beta"]
const FORWARDED_RESPONSE_HEADERS = ["content-type", "request-id", "retry-after"]

// Copilot's /v1/messages rejects a trailing assistant message (prefill) for
// current Claude models, so these requests keep the translation path.
export function shouldUseNativeMessages(payload: {
  model: string
  messages: Array<{ role: string }>
}): boolean {
  return (
    state.nativeMessages
    && payload.model.startsWith("claude")
    && payload.messages.at(-1)?.role !== "assistant"
  )
}

// Copilot names the accepted thinking type in one of two message shapes.
const REPLACEMENT_TYPE =
  /send "thinking": \{"type": "(?<accepted>[a-z_]+)"\} instead of \{"type": "(?<rejected>[a-z_]+)"\}/
const REJECTED_TYPE = /"thinking\.type\.(?<rejected>[a-z_]+)" is not supported/
const ACCEPTED_TYPE = /Use "thinking\.type\.(?<accepted>[a-z_]+)"/

export function acceptedThinkingType(
  errorMessage: string,
  thinkingType: string,
): string | undefined {
  const replacement = REPLACEMENT_TYPE.exec(errorMessage)?.groups
  const rejected =
    replacement?.rejected ?? REJECTED_TYPE.exec(errorMessage)?.groups?.rejected
  const accepted =
    replacement?.accepted ?? ACCEPTED_TYPE.exec(errorMessage)?.groups?.accepted
  return rejected === thinkingType && accepted !== thinkingType ?
      accepted
    : undefined
}

// A client picks the thinking type from the model ID that it knows. A router
// can map that ID to a Copilot model with other rules. Accepted types that
// worked on a retry are cached per upstream model and requested type.
const acceptedThinkingTypes = new Map<string, string>()

function thinkingTypeKey(model: string, thinkingType: string): string {
  return `${model}\u0000${thinkingType}`
}

function upstreamErrorMessage(errorText: string): string {
  try {
    const parsed = JSON.parse(errorText) as { error?: { message?: unknown } }
    const message = parsed.error?.message
    return typeof message === "string" ? message : errorText
  } catch {
    return errorText
  }
}

// Also looks inside nested content, e.g. images in tool_result blocks.
function containsBlock(content: unknown, type: string): boolean {
  return (
    Array.isArray(content)
    && content.some(
      (block: unknown) =>
        typeof block === "object"
        && block !== null
        && "type" in block
        && (block.type === type
          || ("content" in block && containsBlock(block.content, type))),
    )
  )
}

function hasContentBlock(
  payload: NativeMessagesPayload,
  type: string,
): boolean {
  return payload.messages.some((message) =>
    containsBlock(message.content, type),
  )
}

function isAgentCall(payload: NativeMessagesPayload): boolean {
  return (
    payload.messages.some((message) => message.role === "assistant")
    || hasContentBlock(payload, "tool_result")
  )
}

function requestSummary(payload: NativeMessagesPayload): string {
  return (
    `model=${payload.model}`
    + ` thinking=${JSON.stringify(payload.thinking ?? null)}`
    + ` effort=${JSON.stringify(payload.output_config?.effort ?? null)}`
  )
}

function rewriteThinkingType(
  payload: NativeMessagesPayload,
  type: string,
  reason: string,
): void {
  const before = requestSummary(payload)
  const display = payload.thinking?.display
  payload.thinking = { type, ...(display ? { display } : {}) }
  consola.info(
    `Native /v1/messages: ${reason}: ${before} -> ${requestSummary(payload)}`,
  )
}

function postMessages(
  payload: NativeMessagesPayload,
  clientHeaders: Headers,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...copilotHeaders(state, hasContentBlock(payload, "image")),
    "X-Initiator": isAgentCall(payload) ? "agent" : "user",
    "anthropic-version": "2023-06-01",
  }
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = clientHeaders.get(name)
    if (value) headers[name] = value
  }
  return fetch(`${copilotBaseUrl(state)}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
}

export async function createAnthropicMessages(
  payload: NativeMessagesPayload,
  clientHeaders: Headers,
): Promise<Response> {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const thinkingType = payload.thinking?.type
  const cachedType =
    thinkingType ?
      acceptedThinkingTypes.get(thinkingTypeKey(payload.model, thinkingType))
    : undefined
  if (cachedType) rewriteThinkingType(payload, cachedType, "cached rewrite")

  consola.info(`Native /v1/messages: ${requestSummary(payload)}`)
  let response = await postMessages(payload, clientHeaders)

  const retryType =
    response.status === 400 && thinkingType && !cachedType ?
      acceptedThinkingType(
        upstreamErrorMessage(await response.clone().text()),
        thinkingType,
      )
    : undefined
  if (retryType && thinkingType) {
    rewriteThinkingType(payload, retryType, "retry after upstream rejection")
    response = await postMessages(payload, clientHeaders)
    if (response.ok) {
      acceptedThinkingTypes.set(
        thinkingTypeKey(payload.model, thinkingType),
        retryType,
      )
    }
  }

  if (!response.ok) {
    consola.error(
      `Failed to create Anthropic messages: HTTP ${response.status}`,
      await response.clone().text(),
    )
    throw new HTTPError("Failed to create Anthropic messages", response)
  }
  return response
}

export function toClientResponse(upstream: Response): Response {
  const headers = new Headers()
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}
