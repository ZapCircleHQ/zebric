/** Lossless JSON checkpoints: distinguish Dates and undefined from user objects. */
export function encodeRuntimeValue(value: unknown): string {
  const encode = (item: any): any => {
    if (item === undefined) return ['undefined']
    if (item instanceof Date) return ['date', item.toISOString()]
    if (Array.isArray(item)) return ['array', item.map(encode)]
    if (item && typeof item === 'object')
      return ['object', Object.entries(item).map(([key, child]) => [key, encode(child)])]
    if (['function', 'symbol', 'bigint'].includes(typeof item) || (typeof item === 'number' && !Number.isFinite(item)))
      throw new Error('Workflow values must be serializable finite primitives, Dates, arrays or objects')
    return ['value', item]
  }
  return JSON.stringify(encode(value))
}
export function decodeRuntimeValue<T = any>(value: string): T {
  const decode = (item: any): any => {
    switch (item[0]) {
      case 'undefined':
        return undefined
      case 'date':
        return new Date(item[1])
      case 'array':
        return item[1].map(decode)
      case 'object':
        return Object.fromEntries(item[1].map(([key, child]: any[]) => [key, decode(child)]))
      case 'value':
        return item[1]
      default:
        throw new Error('Invalid runtime checkpoint')
    }
  }
  return decode(JSON.parse(value)) as T
}
