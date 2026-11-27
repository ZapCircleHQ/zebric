import { describe, expect, it } from 'vitest'
import { getDevPorts, parsePort, startupErrorMessage } from './dev-preflight.js'

describe('development ports', () => {
  it.each(['3000garbage', '3e3', '1.5', '-1', '65536', '', 'NaN', ' 3000'])('rejects malformed port %j', value => {
    expect(() => parsePort(value)).toThrow('whole-number port')
  })
  it('accepts supported endpoints and explicit admin port selection', () => {
    expect(parsePort('0')).toBe(0)
    expect(parsePort('65535')).toBe(65535)
    expect(getDevPorts()).toEqual({ port: 3000, adminPort: 3030 })
    expect(getDevPorts(0)).toEqual({ port: 0, adminPort: 0 })
    expect(getDevPorts(65535, 0)).toEqual({ port: 65535, adminPort: 0 })
    expect(() => getDevPorts(65535)).toThrow('--admin-port')
    expect(() => getDevPorts(3000, 3000)).toThrow('must differ')
    expect(() => getDevPorts(NaN)).toThrow('whole-number port')
  })
  it('explains database write failures and preserves unknown error messages', () => {
    expect(startupErrorMessage(Object.assign(new Error('Cannot open database'), { code: 'SQLITE_CANTOPEN' }))).toContain('data/app.db')
    expect(startupErrorMessage(new Error('Unexpected condition'))).toBe('Unexpected condition')
  })
})
