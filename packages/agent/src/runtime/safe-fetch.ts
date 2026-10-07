/** Refuse redirects without relying on redirect:'error', which older workerd versions reject. */
export async function fetchWithoutRedirects(
  fetcher: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetcher(input, { ...init, redirect: 'manual' })
  const requestedUrl = new URL(input instanceof Request ? input.url : String(input))
  if ((response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect' || response.redirected) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Zebric request redirects are not allowed')
  }
  if (response.url && new URL(response.url).origin !== requestedUrl.origin) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Zebric request redirected off the application origin')
  }
  return response
}
