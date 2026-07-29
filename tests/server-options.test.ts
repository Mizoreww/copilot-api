import { describe, expect, test } from "bun:test"

import { createServeOptions } from "~/start"

const fetch = () => new Response("ok")

describe("HTTP server options", () => {
  test("allows long pauses between streaming response chunks", () => {
    const options = createServeOptions(fetch, 4141)

    expect(options.bun?.idleTimeout).toBe(255)
  })
})
