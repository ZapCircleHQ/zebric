/**
 * Tests for Programmatic Runtime API
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Zebric, createZebric, createTestZebric } from './programmatic.js'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Programmatic Runtime API', () => {
  let testDir: string
  let testBlueprintPath: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `zebric-programmatic-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    // Create a valid test Blueprint
    testBlueprintPath = join(testDir, 'blueprint.toml')
    await writeFile(
      testBlueprintPath,
      `
version = "1.0"

[project]
name = "Test App"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email", required = true }
]

[page."/"]
title = "Home"
layout = "list"

[page."/".queries.users]
entity = "User"
`
    )
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('Zebric class', () => {
    it('should create a Zebric instance', () => {
      const zebric = new Zebric({
        blueprintPath: testBlueprintPath,
        port: 0, // Random port
      })

      expect(zebric).toBeInstanceOf(Zebric)
      expect(zebric.running()).toBe(false)
    })

    it('should start and stop the server', async () => {
      const zebric = new Zebric({
        blueprintPath: testBlueprintPath,
        port: 0,
        databaseUrl: 'sqlite://:memory:',
      })

      expect(zebric.running()).toBe(false)

      await zebric.start()
      expect(zebric.running()).toBe(true)

      const url = zebric.getUrl()
      expect(url).toMatch(/^http:\/\//)

      await zebric.stop()
      expect(zebric.running()).toBe(false)
    }, 30000)

    it('should throw if starting when already running', async () => {
      const zebric = new Zebric({
        blueprintPath: testBlueprintPath,
        port: 0,
        databaseUrl: 'sqlite://:memory:',
      })

      await zebric.start()

      await expect(zebric.start()).rejects.toThrow('already running')

      await zebric.stop()
    }, 30000)

    it('should throw if stopping when not running', async () => {
      const zebric = new Zebric({
        blueprintPath: testBlueprintPath,
        port: 0,
      })

      await expect(zebric.stop()).rejects.toThrow('not running')
    })

    it('should validate Blueprint before starting', async () => {
      const invalidBlueprintPath = join(testDir, 'invalid.toml')
      await writeFile(invalidBlueprintPath, 'invalid content')

      const zebric = new Zebric({
        blueprintPath: invalidBlueprintPath,
        port: 0,
        validateBeforeStart: true,
      })

      await expect(zebric.start()).rejects.toThrow('validation failed')
    })

    it('should skip validation if disabled', async () => {
      const invalidBlueprintPath = join(testDir, 'invalid.toml')
      await writeFile(
        invalidBlueprintPath,
        `
version = "1.0"

[project]
name = "Test"
# Missing required fields - will fail at engine start, not validation
`
      )

      const zebric = new Zebric({
        blueprintPath: invalidBlueprintPath,
        port: 0,
        validateBeforeStart: false,
      })

      // Should fail at engine.start() instead of validation
      await expect(zebric.start()).rejects.toThrow()
    })

    it('should return null for admin URL when not in dev mode', async () => {
      const zebric = new Zebric({
        blueprintPath: testBlueprintPath,
        port: 0,
        databaseUrl: 'sqlite://:memory:',
        dev: false,
      })

      await zebric.start()

      expect(zebric.getAdminUrl()).toBeNull()

      await zebric.stop()
    }, 30000)

    it('should return admin URL when in dev mode', async () => {
      const zebric = new Zebric({
        blueprintPath: testBlueprintPath,
        port: 0,
        databaseUrl: 'sqlite://:memory:',
        dev: true,
      })

      await zebric.start()

      const adminUrl = zebric.getAdminUrl()
      expect(adminUrl).toMatch(/^http:\/\//)

      await zebric.stop()
    }, 30000)

    it('should throw when getting URL if not running', () => {
      const zebric = new Zebric({
        blueprintPath: testBlueprintPath,
      })

      expect(() => zebric.getUrl()).toThrow('not running')
    })
  })

  describe('createZebric', () => {
    it('should create and start a Zebric instance', async () => {
      const zebric = await createZebric({
        blueprintPath: testBlueprintPath,
        port: 0,
        databaseUrl: 'sqlite://:memory:',
      })

      expect(zebric.running()).toBe(true)

      const url = zebric.getUrl()
      expect(url).toMatch(/^http:\/\//)

      await zebric.stop()
    }, 30000)
  })

  describe('createTestZebric', () => {
    it('should create a test instance with in-memory database', async () => {
      const zebric = await createTestZebric(testBlueprintPath)

      expect(zebric.running()).toBe(true)

      const url = zebric.getUrl()
      expect(url).toMatch(/^http:\/\//)

      // Should use in-memory database
      const engine = zebric.getEngine()
      expect(engine).toBeDefined()

      await zebric.stop()
    }, 30000)
  })
})
