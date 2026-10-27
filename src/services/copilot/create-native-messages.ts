import consola from "consola"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

import { acceptedThinkingTypes, thinkingRejection } from "./thinking-type"

// Sends Anthropic Messages requests to Copilot's native /v1/messages endpoint
// without translation, because the /chat/completions translation drops
// `thinking` and `output_config.effort`. Only a thinking type that Copilot
// rejects is changed, in a copy of the payload.

export interface NativeMessagesPayload {
  model: string
  messages: Array<{ role: string; content: unknown }>
  thinking?: { type: string; display?: string }
  output_config?: { effort?: string }
}

const FORWARDED_REQUEST_HEADERS = ["anthropic-version", "anthropic-beta"]

// Also looks inside nested content, e.g. images in tool_result blocks.
function contentHasBlock(content: unknown, type: string): boolean {
  return (
    Array.isArray(content)
    && content.some(
      (block: unknown) =>
        typeof block === "object"
        && block !== null
        && "type" in block
        && (block.type === type
          || ("content" in block && contentHasBlock(block.content, type))),
    )
  )
}

function payloadHasBlock(
  payload: NativeMessagesPayload,
  type: string,
): boolean {
  return payload.messages.some((message) =>
    contentHasBlock(message.content, type),
  )
}

function isAgentCall(payload: NativeMessagesPayload): boolean {
  return (
    payload.messages.some((message) => message.role === "assistant")
    || payloadHasBlock(payload, "tool_result")
  )
}

function withThinkingType(
  payload: NativeMessagesPayload,
  type: string,
): NativeMessagesPayload {
  const display = payload.thinking?.display
  return { ...payload, thinking: { type, ...(display ? { display } : {}) } }
}

function requestSummary(payload: NativeMessagesPayload): string {
  return (
    `model=${payload.model}`
    + ` thinking=${JSON.stringify(payload.thinking ?? null)}`
    + ` effort=${JSON.stringify(payload.output_config?.effort ?? null)}`
  )
}

function postMessages(
  payload: NativeMessagesPayload,
  clientHeaders: Headers,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...copilotHeaders(state, payloadHasBlock(payload, "image")),
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

export async function createNativeMessages(
  payload: NativeMessagesPayload,
  clientHeaders: Headers,
): Promise<Response> {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const thinkingType = payload.thinking?.type
  const cachedType =
    thinkingType ?
      acceptedThinkingTypes.get(payload.model, thinkingType)
    : undefined
  let body = cachedType ? withThinkingType(payload, cachedType) : payload
  consola.info(`Native /v1/messages: ${requestSummary(body)}`)
  let response = await postMessages(body, clientHeaders)

  // Retry once with the type that the error names. A cached type that
  // Copilot rejects later is dropped, so the cache cannot block requests.
  const sentType = body.thinking?.type
  const rejection =
    response.status === 400 && sentType ?
      thinkingRejection(await response.clone().text())
    : undefined
  if (thinkingType && rejection && rejection.rejected === sentType) {
    acceptedThinkingTypes.delete(payload.model, thinkingType)
    const accepted = rejection.accepted
    if (accepted && accepted !== sentType) {
      body = withThinkingType(payload, accepted)
      consola.info(`Native /v1/messages: retry: ${requestSummary(body)}`)
      response = await postMessages(body, clientHeaders)
      if (response.ok && accepted !== thinkingType) {
        acceptedThinkingTypes.set(payload.model, thinkingType, accepted)
      }
    }
  }

  if (!response.ok) {
    consola.error(
      `Failed to create native messages: HTTP ${response.status}`,
      await response.clone().text(),
    )
    throw new HTTPError("Failed to create native messages", response)
  }
  return response
}
