import { awaitApproval } from "~/lib/approval"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import {
  createNativeMessages,
  type NativeMessagesPayload,
} from "~/services/copilot/create-native-messages"

const FORWARDED_RESPONSE_HEADERS = ["content-type", "request-id", "retry-after"]

// Copilot's /v1/messages rejects a trailing assistant message (prefill) for
// current Claude models, so these requests keep the translation path.
export function shouldUseNativeMessages(
  payload: NativeMessagesPayload,
): boolean {
  return (
    state.nativeMessages
    && payload.model.startsWith("claude")
    && payload.messages.at(-1)?.role !== "assistant"
  )
}

function toClientResponse(upstream: Response): Response {
  const headers = new Headers()
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}

export async function handleNativeCompletion(
  payload: NativeMessagesPayload,
  clientHeaders: Headers,
): Promise<Response> {
  if (state.manualApprove) {
    await awaitApproval()
  }

  try {
    return toClientResponse(await createNativeMessages(payload, clientHeaders))
  } catch (error) {
    // Upstream errors keep their status, body and retry-after so that the
    // client can decide whether to retry.
    if (error instanceof HTTPError) return toClientResponse(error.response)
    throw error
  }
}
