/** A same-origin relative path to return to after sign-in, or '/'. Used by the middleware, the forms and the server. */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}
