// Copilot rejects some thinking types per model with HTTP 400 and names the
// type that it accepts, in one of two message shapes:
//   "thinking.type.disabled" is not supported ... Use "thinking.type.adaptive" ...
//   send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}
const REPLACEMENT_PATTERN =
  /send "thinking": \{"type": "(?<accepted>[a-z_]+)"\} instead of \{"type": "(?<rejected>[a-z_]+)"\}/
const REJECTED_PATTERN =
  /"thinking\.type\.(?<rejected>[a-z_]+)" is not supported/
const ACCEPTED_PATTERN = /Use "thinking\.type\.(?<accepted>[a-z_]+)"/

export interface ThinkingRejection {
  rejected: string
  accepted: string | undefined
}

function errorMessage(errorBody: string): string {
  try {
    const parsed = JSON.parse(errorBody) as { error?: { message?: unknown } }
    const message = parsed.error?.message
    return typeof message === "string" ? message : errorBody
  } catch {
    return errorBody
  }
}

export function thinkingRejection(
  errorBody: string,
): ThinkingRejection | undefined {
  const message = errorMessage(errorBody)
  const replacement = REPLACEMENT_PATTERN.exec(message)?.groups
  const rejected =
    replacement?.rejected ?? REJECTED_PATTERN.exec(message)?.groups?.rejected
  if (!rejected) return undefined
  const accepted =
    replacement?.accepted ?? ACCEPTED_PATTERN.exec(message)?.groups?.accepted
  return { rejected, accepted }
}

// A client picks the thinking type from the model ID that it knows. A router
// can map that ID to a Copilot model with other rules. The cache holds the
// accepted type per upstream model and requested type.
class AcceptedThinkingTypes {
  readonly #byModel = new Map<string, Map<string, string>>()

  get(model: string, thinkingType: string): string | undefined {
    return this.#byModel.get(model)?.get(thinkingType)
  }

  set(model: string, thinkingType: string, accepted: string): void {
    const types = this.#byModel.get(model) ?? new Map<string, string>()
    types.set(thinkingType, accepted)
    this.#byModel.set(model, types)
  }

  delete(model: string, thinkingType: string): void {
    this.#byModel.get(model)?.delete(thinkingType)
  }

  clear(): void {
    this.#byModel.clear()
  }
}

export const acceptedThinkingTypes = new AcceptedThinkingTypes()
