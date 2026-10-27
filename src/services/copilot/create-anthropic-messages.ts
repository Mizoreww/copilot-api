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

interface ThinkingConfig {
  type?: string
  display?: string
  [key: string]: unknown
}

export interface PassthroughPayload {
  model: string
  messages: Array<PassthroughMessage>
  thinking?: ThinkingConfig
  output_config?: { effort?: string; [key: string]: unknown }
  [key: string]: unknown
}

export type ThinkingFix = (payload: PassthroughPayload) => void

const FORWARDED_CLIENT_HEADERS = ["anthropic-version", "anthropic-beta"]

// Clients choose the thinking type from the model ID they know, which may be
// remapped (e.g. by cc-switch) to a Copilot model with different rules.
// Learned per upstream model: thinking type -> rewrite.
const learnedThinkingFixes = new Map<string, Map<string, ThinkingFix>>()

export function thinkingFixFromError(
  thinkingType: string,
  errorMessage: string,
): ThinkingFix | undefined {
  const suggested = errorMessage.match(
    /send "thinking": \{"type": "([a-z_]+)"\} instead of \{"type": "([a-z_]+)"\}/,
  )
  if (suggested && suggested[2] === thinkingType) {
    const type = suggested[1]
    return (payload) => {
      payload.thinking = { type }
    }
  }

  if (
    !errorMessage.includes(`"thinking.type.${thinkingType}" is not supported`)
    || !errorMessage.includes(`"thinking.type.adaptive"`)
  ) {
    return undefined
  }

  if (thinkingType === "enabled") {
    return (payload) => {
      const display = payload.thinking?.display
      payload.thinking = { type: "adaptive", ...(display ? { display } : {}) }
    }
  }

  // The model cannot turn thinking off; low effort is the closest request.
  return (payload) => {
    payload.thinking = { type: "adaptive" }
    payload.output_config = { ...payload.output_config, effort: "low" }
  }
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

function describe(payload: PassthroughPayload): string {
  return (
    `model=${payload.model}`
    + ` thinking=${JSON.stringify(payload.thinking ?? null)}`
    + ` effort=${JSON.stringify(payload.output_config?.effort ?? null)}`
  )
}

async function send(
  payload: PassthroughPayload,
  clientHeaders: Headers,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...copilotHeaders(state, hasImage(payload)),
    "X-Initiator": isAgentCall(payload) ? "agent" : "user",
    "anthropic-version": "2023-06-01",
  }
  for (const name of FORWARDED_CLIENT_HEADERS) {
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
  payload: PassthroughPayload,
  clientHeaders: Headers,
): Promise<Response> {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const originalType = payload.thinking?.type
  const learned =
    originalType ?
      learnedThinkingFixes.get(payload.model)?.get(originalType)
    : undefined
  if (learned) {
    const before = describe(payload)
    learned(payload)
    consola.info(
      `Native /v1/messages: rewrote ${before} -> ${describe(payload)}`,
    )
  }

  consola.info(`Native /v1/messages: ${describe(payload)}`)
  const response = await send(payload, clientHeaders)
  if (response.ok) return response

  const errorText = await response.text()
  const fix =
    originalType && !learned ?
      thinkingFixFromError(originalType, upstreamErrorMessage(errorText))
    : undefined

  if (!fix) {
    consola.error(
      `Failed native /v1/messages: HTTP ${response.status}`,
      errorText,
    )
    return new Response(errorText, {
      status: response.status,
      headers: response.headers,
    })
  }

  const fixes =
    learnedThinkingFixes.get(payload.model) ?? new Map<string, ThinkingFix>()
  fixes.set(originalType as string, fix)
  learnedThinkingFixes.set(payload.model, fixes)

  const before = describe(payload)
  fix(payload)
  consola.info(
    `Native /v1/messages: upstream rejected ${before}; retrying as ${describe(payload)}`,
  )
  const retried = await send(payload, clientHeaders)
  if (!retried.ok) {
    consola.error(
      `Failed native /v1/messages after retry: HTTP ${retried.status}`,
      await retried.clone().text(),
    )
  }
  return retried
}
