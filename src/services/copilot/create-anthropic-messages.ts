import consola from "consola"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { state } from "~/lib/state"

// Native Anthropic Messages passthrough to Copilot's /v1/messages.
// Keeps model, thinking, output_config.effort, cache_control etc. intact,
// which the OpenAI /chat/completions translation drops.

interface PassthroughMessage {
  role: string
  content: unknown
}

export interface PassthroughPayload {
  model: string
  messages: Array<PassthroughMessage>
  [key: string]: unknown
}

const FORWARDED_CLIENT_HEADERS = ["anthropic-version", "anthropic-beta"]

function isAgentCall(payload: PassthroughPayload): boolean {
  return payload.messages.some(
    (msg) =>
      msg.role === "assistant"
      || (Array.isArray(msg.content)
        && msg.content.some(
          (block) =>
            typeof block === "object"
            && block !== null
            && (block as { type?: string }).type === "tool_result",
        )),
  )
}

function hasImage(payload: PassthroughPayload): boolean {
  return payload.messages.some(
    (msg) =>
      Array.isArray(msg.content)
      && msg.content.some(
        (block) =>
          typeof block === "object"
          && block !== null
          && (block as { type?: string }).type === "image",
      ),
  )
}

export async function createAnthropicMessages(
  payload: PassthroughPayload,
  clientHeaders: Headers,
): Promise<Response> {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers: Record<string, string> = {
    ...copilotHeaders(state, hasImage(payload)),
    "X-Initiator": isAgentCall(payload) ? "agent" : "user",
    "anthropic-version": "2023-06-01",
  }
  for (const name of FORWARDED_CLIENT_HEADERS) {
    const value = clientHeaders.get(name)
    if (value) headers[name] = value
  }

  consola.info(
    `Native /v1/messages: model=${payload.model}`
      + ` thinking=${JSON.stringify(payload.thinking ?? null)}`
      + ` effort=${JSON.stringify((payload.output_config as { effort?: string } | undefined)?.effort ?? null)}`,
  )

  const response = await fetch(`${copilotBaseUrl(state)}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error(
      `Failed native /v1/messages: HTTP ${response.status}`,
      await response.clone().text(),
    )
  }
  return response
}
