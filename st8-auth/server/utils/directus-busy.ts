// A busy Directus: requests it refused without running them. Its pressure limiter (503 "Under pressure" while its own
// event loop is overloaded, whoever caused the load), its rate limiter (429 per IP; an app's serverless functions share a
// few) and a connection that never opened. Each is retried, writes too, since nothing was executed; if Directus is still
// busy the app answers 503 with Retry-After (server/plugins/st8-directus-busy.ts) instead of a 500. Every other error
// passes through unchanged, including other 503s (Directus also answers 503 when, say, its mail service fails after the
// work is done).

const RETRY_DELAYS_MS = [250, 750]
const MAX_WAIT_MS = 2000

/** Seconds a client is asked to wait (Retry-After) when Directus is still busy after the retries. */
export const DIRECTUS_BUSY_RETRY_AFTER = 2

/** Network failures before the request reached Directus. */
const NOT_SENT = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'])

interface BusyError {
  errors?: { extensions?: { reason?: string } }[]
  data?: { errors?: { extensions?: { reason?: string } }[] }
  response?: { headers?: Headers }
  cause?: { code?: string, cause?: { code?: string } }
}

/** How long to wait before retrying `err`, or null when it isn't a refusal Directus never acted on. */
function busyDelay(err: unknown, fallback: number): number | null {
  const e = err as BusyError
  const { status, code, message } = directusError(err)
  const reason = (e?.data?.errors ?? e?.errors)?.[0]?.extensions?.reason
  // ServiceUnavailableError({ service: 'api', reason: 'Under pressure' })
  const pressure = status === 503 && code === 'SERVICE_UNAVAILABLE' && (reason === 'Under pressure' || /under pressure/i.test(message ?? ''))
  if ((status === 429 && code === 'REQUESTS_EXCEEDED') || pressure) {
    const header = Number(e?.response?.headers?.get?.('retry-after'))
    return header > 0 ? Math.min(header * 1000, MAX_WAIT_MS) : fallback
  }
  // The SDK rethrows fetch's TypeError (cause.code); $fetch wraps it once more (cause.cause.code).
  const net = e?.cause?.code ?? e?.cause?.cause?.code
  return net && NOT_SENT.has(net) ? fallback : null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run a Directus call, retrying it while Directus is busy (after 250 ms, then 750 ms, or its Retry-After up to 2 s);
 * still busy: a 503 with `data.retryAfter`. Any other error is thrown as it came.
 */
export async function retryDirectusBusy<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (err) {
      const delay = busyDelay(err, RETRY_DELAYS_MS[attempt] ?? 0)
      if (delay === null) throw err
      const e = err as BusyError
      const reason = directusError(err).status ?? e?.cause?.code ?? e?.cause?.cause?.code
      if (attempt >= RETRY_DELAYS_MS.length) {
        console.warn(`[directus] still busy (${reason}) after ${attempt} retries; answering 503`)
        throw createError({ statusCode: 503, statusMessage: 'Service Unavailable', message: 'The service is busy right now. Please try again in a moment.', data: { retryAfter: DIRECTUS_BUSY_RETRY_AFTER } })
      }
      console.warn(`[directus] busy (${reason}); retrying in ${delay} ms`)
      await sleep(delay)
    }
  }
}

/**
 * Give a Directus SDK client the busy retry (`retryDirectusBusy`) on every request. The host wraps the clients its
 * `getDirectus()` and `getUserDirectus(token)` return, so every layer route gets it.
 */
export function withDirectusRetry<T extends { request: (...args: never[]) => Promise<unknown> }>(client: T): T {
  const request = client.request.bind(client) as (...args: unknown[]) => Promise<unknown>
  client.request = ((...args: unknown[]) => retryDirectusBusy(() => request(...args))) as T['request']
  return client
}
