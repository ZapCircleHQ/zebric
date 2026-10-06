/** Node-compatible bearer or timestamped HMAC webhook authentication. */
export async function verifyWebhookRequest(request: Request, rawBody: string, secret: string): Promise<boolean> {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.toLowerCase().startsWith('bearer ')) {
    const [received, expected] = await Promise.all(
      [authorization.slice(7), secret].map((value) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
    )
    const left = new Uint8Array(received)
    const right = new Uint8Array(expected)
    let difference = 0
    for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!
    if (difference === 0) return true
  }
  const timestamp = request.headers.get('x-zebric-webhook-timestamp') ?? ''
  const signature = request.headers.get('x-zebric-webhook-signature') ?? ''
  if (!/^\d+$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false
  if (!Number.isSafeInteger(Number(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (hex) => parseInt(hex, 16))
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(`${timestamp}.${rawBody}`))
}
