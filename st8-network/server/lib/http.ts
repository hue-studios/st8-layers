// Small request helpers for the network routes.

type H3Event = Parameters<typeof getRequestIP>[0]

/** The JSON body as an object, or a 400. */
export async function readJson<T extends Record<string, unknown>>(event: H3Event): Promise<Partial<T>> {
  const body = await readBody<unknown>(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: 'Expected a JSON object.' })
  return body as Partial<T>
}

export const noStore = (event: H3Event) => setResponseHeader(event, 'Cache-Control', 'private, no-store')
