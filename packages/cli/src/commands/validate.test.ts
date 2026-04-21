import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateCommand } from './validate.js'

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock('@zebric/runtime-node', async () => {
  class BlueprintValidationError extends Error {
    structured: any
    constructor(message: string, structured: any) {
      super(message)
      this.name = 'BlueprintValidationError'
      this.structured = structured
    }
  }
  return {
    BlueprintParser: vi.fn().mockImplementation(() => ({
      parse: vi.fn(),
    })),
    detectFormat: vi.fn().mockReturnValue('toml'),
    BlueprintValidationError,
  }
})

import { access, readFile } from 'node:fs/promises'
import { BlueprintParser, detectFormat, BlueprintValidationError } from '@zebric/runtime-node'

const mockAccess = access as ReturnType<typeof vi.fn>
const mockReadFile = readFile as ReturnType<typeof vi.fn>
const MockBlueprintParser = BlueprintParser as ReturnType<typeof vi.fn>

describe('validateCommand', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>
  let mockConsoleError: ReturnType<typeof vi.spyOn>
  let mockExit: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExit = vi.spyOn(process, 'exit').mockImplementation((_code?: any) => {
      throw new Error(`EXIT:${_code}`)
    })
  })

  afterEach(() => {
    mockConsoleLog.mockRestore()
    mockConsoleError.mockRestore()
    mockExit.mockRestore()
  })

  describe('file not found', () => {
    it('prints error and exits when blueprint file is missing', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'))

      await expect(validateCommand({ blueprint: 'missing.toml' })).rejects.toThrow('EXIT:1')
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('not found'))
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('defaults to blueprint.toml when no path given', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'))

      await expect(validateCommand()).rejects.toThrow('EXIT:1')
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('blueprint.toml'))
    })
  })

  describe('valid blueprint', () => {
    beforeEach(() => {
      mockAccess.mockResolvedValue(undefined)
      mockReadFile.mockResolvedValue('[project]\nname = "test"')
    })

    it('prints success info when blueprint is valid', async () => {
      const fakeBp = {
        version: '1.0',
        project: { name: 'My App' },
        entities: [{ name: 'User' }, { name: 'Post' }],
        pages: [{ path: '/' }],
      }
      MockBlueprintParser.mockImplementation(() => ({
        parse: vi.fn().mockReturnValue(fakeBp),
      }))

      await validateCommand({ blueprint: 'blueprint.toml' })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('valid'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('1.0'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('My App'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('2 entities'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('1 pages'))
    })

    it('includes workflow count when blueprint has workflows', async () => {
      const fakeBp = {
        version: '1.0',
        project: { name: 'App' },
        entities: [],
        pages: [],
        workflows: [{ name: 'wf1' }, { name: 'wf2' }],
      }
      MockBlueprintParser.mockImplementation(() => ({
        parse: vi.fn().mockReturnValue(fakeBp),
      }))

      await validateCommand({ blueprint: 'blueprint.toml' })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('2 workflows'))
    })

    it('omits workflow section when blueprint has no workflows', async () => {
      const fakeBp = {
        version: '1.0',
        project: { name: 'App' },
        entities: [],
        pages: [],
      }
      MockBlueprintParser.mockImplementation(() => ({
        parse: vi.fn().mockReturnValue(fakeBp),
      }))

      await validateCommand({ blueprint: 'blueprint.toml' })

      const projectLine = mockConsoleLog.mock.calls.find(call =>
        String(call[0]).includes('Project:')
      )?.[0] as string
      expect(projectLine).not.toContain('workflows')
    })
  })

  describe('BlueprintValidationError', () => {
    beforeEach(() => {
      mockAccess.mockResolvedValue(undefined)
      mockReadFile.mockResolvedValue('invalid content')
    })

    it('prints structured errors and exits', async () => {
      const structured = {
        type: 'ValidationError',
        message: 'Schema invalid',
        errors: [
          {
            location: { path: ['project', 'name'] },
            message: 'Required field missing',
            expected: 'string',
            received: 'undefined',
            suggestion: 'Add a name field',
          },
        ],
      }
      MockBlueprintParser.mockImplementation(() => ({
        parse: vi.fn().mockImplementation(() => {
          throw new BlueprintValidationError('Schema invalid', structured)
        }),
      }))

      await expect(validateCommand({ blueprint: 'blueprint.toml' })).rejects.toThrow('EXIT:1')
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('validation failed'))
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('project.name'))
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Required field missing'))
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('string'))
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Add a name field'))
    })

    it('handles errors with empty location path (shows root)', async () => {
      const structured = {
        type: 'ValidationError',
        message: 'Top-level error',
        errors: [
          {
            location: { path: [] },
            message: 'Root level problem',
          },
        ],
      }
      MockBlueprintParser.mockImplementation(() => ({
        parse: vi.fn().mockImplementation(() => {
          throw new BlueprintValidationError('Top-level error', structured)
        }),
      }))

      await expect(validateCommand({ blueprint: 'blueprint.toml' })).rejects.toThrow('EXIT:1')
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('root'))
    })

    it('handles validation error with no detail errors', async () => {
      const structured = {
        type: 'ParseError',
        message: 'Invalid TOML syntax',
        errors: [],
      }
      MockBlueprintParser.mockImplementation(() => ({
        parse: vi.fn().mockImplementation(() => {
          throw new BlueprintValidationError('Invalid TOML syntax', structured)
        }),
      }))

      await expect(validateCommand({ blueprint: 'blueprint.toml' })).rejects.toThrow('EXIT:1')
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('ParseError'))
    })
  })

  describe('generic error handling', () => {
    beforeEach(() => {
      mockAccess.mockResolvedValue(undefined)
      mockReadFile.mockResolvedValue('...')
    })

    it('prints Error.message and exits for unknown errors', async () => {
      MockBlueprintParser.mockImplementation(() => ({
        parse: vi.fn().mockImplementation(() => {
          throw new Error('Unexpected parse failure')
        }),
      }))

      await expect(validateCommand({ blueprint: 'blueprint.toml' })).rejects.toThrow('EXIT:1')
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Failed to validate'))
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unexpected parse failure'))
    })

    it('handles non-Error throws', async () => {
      MockBlueprintParser.mockImplementation(() => ({
        parse: vi.fn().mockImplementation(() => {
          throw 'string error'
        }),
      }))

      await expect(validateCommand({ blueprint: 'blueprint.toml' })).rejects.toThrow('EXIT:1')
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('string error'))
    })
  })
})
