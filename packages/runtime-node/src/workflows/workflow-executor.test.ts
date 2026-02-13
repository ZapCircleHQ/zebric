/**
 * Integration tests for WorkflowExecutor
 *
 * Tests the workflow executor with HTTP client integration,
 * query execution, and error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowExecutor, type HttpClient, type EmailService } from './workflow-executor.js'
import type { Workflow, WorkflowContext } from './types.js'
import type { QueryExecutor } from '../database/query-executor.js'

describe('WorkflowExecutor', () => {
  let mockDataLayer: QueryExecutor
  let mockHttpClient: HttpClient
  let mockEmailService: EmailService
  let mockNotificationService: { send: ReturnType<typeof vi.fn> }
  let mockEntityEventHandler: ReturnType<typeof vi.fn>
  let executor: WorkflowExecutor

  beforeEach(() => {
    // Mock data layer
    mockDataLayer = {
      create: vi.fn().mockResolvedValue({ id: '123' }),
      update: vi.fn().mockResolvedValue({ id: '123', updated: true }),
      delete: vi.fn().mockResolvedValue({ deleted: true }),
      findById: vi.fn().mockResolvedValue({ id: '123', status: 'triage' }),
      execute: vi.fn().mockResolvedValue([{ id: '123', name: 'Test' }]),
    } as any

    // Mock HTTP client
    mockHttpClient = {
      request: vi.fn().mockResolvedValue({ success: true, data: 'response' }),
    }

    // Mock email service
    mockEmailService = {
      send: vi.fn().mockResolvedValue(undefined),
    }

    mockNotificationService = {
      send: vi.fn().mockResolvedValue(undefined),
    }
    mockEntityEventHandler = vi.fn().mockResolvedValue(undefined)

    executor = new WorkflowExecutor({
      dataLayer: mockDataLayer,
      httpClient: mockHttpClient,
      emailService: mockEmailService,
      notificationService: mockNotificationService as any,
      onEntityEvent: mockEntityEventHandler,
    })
  })

  describe('HTTP client integration', () => {
    it('should execute webhook step with HTTP client', async () => {
      const workflow: Workflow = {
        name: 'test-webhook',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/notify',
            method: 'POST',
            payload: { message: 'Hello' },
            assignTo: 'webhookResult',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(true)
      expect(mockHttpClient.request).toHaveBeenCalledWith(
        'https://api.example.com/notify',
        {
          method: 'POST',
          headers: {},
          body: { message: 'Hello' },
        }
      )
      expect(context.variables.webhookResult).toEqual({ success: true, data: 'response' })
    })

    it('should execute webhook with variable interpolation', async () => {
      const workflow: Workflow = {
        name: 'test-webhook-variables',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/users/{{variables.userId}}',
            method: 'POST',
            payload: { name: '{{variables.userName}}' },
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: { userId: '456', userName: 'John Doe' },
      }

      await executor.execute(workflow, context)

      expect(mockHttpClient.request).toHaveBeenCalledWith(
        'https://api.example.com/users/456',
        {
          method: 'POST',
          headers: {},
          body: { name: 'John Doe' },
        }
      )
    })

    it('should execute GET webhook without body', async () => {
      const workflow: Workflow = {
        name: 'test-webhook-get',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/data',
            method: 'GET',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      await executor.execute(workflow, context)

      expect(mockHttpClient.request).toHaveBeenCalledWith(
        'https://api.example.com/data',
        {
          method: 'GET',
          headers: {},
          body: undefined,
        }
      )
    })

    it('should execute webhook with custom headers', async () => {
      const workflow: Workflow = {
        name: 'test-webhook-headers',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/secure',
            method: 'POST',
            headers: {
              'Authorization': 'Bearer token123',
              'X-Custom': 'value',
            },
            payload: { data: 'test' },
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      await executor.execute(workflow, context)

      expect(mockHttpClient.request).toHaveBeenCalledWith(
        'https://api.example.com/secure',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer token123',
            'X-Custom': 'value',
          },
          body: { data: 'test' },
        }
      )
    })

    it('should throw error when HTTP client not configured', async () => {
      const executorNoHttp = new WorkflowExecutor({
        dataLayer: mockDataLayer,
      })

      const workflow: Workflow = {
        name: 'test-webhook',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/notify',
            method: 'POST',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executorNoHttp.execute(workflow, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('HTTP client not configured')
    })

    it('should handle HTTP client errors gracefully', async () => {
      mockHttpClient.request = vi.fn().mockRejectedValue(new Error('Network timeout'))

      const workflow: Workflow = {
        name: 'test-webhook-error',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/notify',
            method: 'POST',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network timeout')
      expect(result.logs.some(log => log.level === 'error')).toBe(true)
    })
  })

  describe('notifications', () => {
    it('should execute notify step', async () => {
      const workflow: Workflow = {
        name: 'notify-test',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'notify',
            adapter: 'console',
            channel: '#general',
            template: 'Welcome {{variables.userName}}',
            params: { app: 'OpsHub' },
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: { userName: 'Dana' },
      }

      await executor.execute(workflow, context)

      expect(mockNotificationService.send).toHaveBeenCalledWith({
        adapter: 'console',
        channel: '#general',
        to: undefined,
        subject: undefined,
        body: undefined,
        template: 'Welcome {{variables.userName}}',
        params: { app: 'OpsHub' },
        metadata: undefined,
      })
    })

    it('should execute notify step with resolved metadata', async () => {
      const workflow: Workflow = {
        name: 'notify-metadata-test',
        trigger: { entity: 'request', event: 'update' },
        steps: [
          {
            type: 'notify',
            adapter: 'slack',
            channel: '#dispatch',
            body: 'Request {{trigger.after.id}} resolved',
            metadata: {
              threadTs: '{{trigger.after.threadTs}}',
              mrkdwn: true,
            },
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: {
          type: 'entity',
          entity: 'request',
          event: 'update',
          after: { id: 'req_123', threadTs: '1700000000.123456' },
        },
        variables: {},
      }

      await executor.execute(workflow, context)

      expect(mockNotificationService.send).toHaveBeenCalledWith({
        adapter: 'slack',
        channel: '#dispatch',
        to: undefined,
        subject: undefined,
        body: 'Request req_123 resolved',
        template: undefined,
        params: undefined,
        metadata: {
          threadTs: '1700000000.123456',
          mrkdwn: true,
        },
      })
    })
  })

  describe('query execution', () => {
    it('should execute create query', async () => {
      const workflow: Workflow = {
        name: 'test-create',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'query',
            entity: 'user',
            action: 'create',
            data: { name: 'John', email: 'john@example.com' },
            assignTo: 'newUser',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(true)
      expect(mockDataLayer.create).toHaveBeenCalledWith('user', {
        name: 'John',
        email: 'john@example.com',
      })
      expect(context.variables.newUser).toEqual({ id: '123' })
    })

    it('should propagate entity events from query update steps', async () => {
      const workflow: Workflow = {
        name: 'propagate-update-event',
        trigger: { entity: 'user', event: 'update' },
        steps: [
          {
            type: 'query',
            entity: 'user',
            action: 'update',
            where: { id: '123' },
            data: { status: 'resolved' },
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'update' },
        variables: {
          __zebric: {
            sourceWorkflow: 'upstream-workflow',
            depth: 2,
          },
        },
      }

      await executor.execute(workflow, context)

      expect(mockEntityEventHandler).toHaveBeenCalledWith({
        entity: 'user',
        event: 'update',
        before: { id: '123', status: 'triage' },
        after: { id: '123', updated: true },
        sourceWorkflow: 'upstream-workflow',
        depth: 2,
      })
    })

    it('should execute update query', async () => {
      const workflow: Workflow = {
        name: 'test-update',
        trigger: { entity: 'user', event: 'update' },
        steps: [
          {
            type: 'query',
            entity: 'user',
            action: 'update',
            where: { id: '123' },
            data: { name: 'Jane' },
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'update' },
        variables: {},
      }

      await executor.execute(workflow, context)

      expect(mockDataLayer.update).toHaveBeenCalledWith(
        'user',
        '123',
        { name: 'Jane' }
      )
    })

    it('should execute delete query', async () => {
      const workflow: Workflow = {
        name: 'test-delete',
        trigger: { entity: 'user', event: 'delete' },
        steps: [
          {
            type: 'query',
            entity: 'user',
            action: 'delete',
            where: { id: '123' },
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'delete' },
        variables: {},
      }

      await executor.execute(workflow, context)

      expect(mockDataLayer.delete).toHaveBeenCalledWith('user', '123')
    })

    it('should execute find query', async () => {
      const workflow: Workflow = {
        name: 'test-find',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'query',
            entity: 'user',
            action: 'find',
            where: { status: 'active' },
            assignTo: 'users',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(true)
      expect(mockDataLayer.execute).toHaveBeenCalledWith({
        entity: 'user',
        where: { status: 'active' },
      })
      expect(context.variables.users).toEqual([{ id: '123', name: 'Test' }])
    })
  })

  describe('email execution', () => {
    it('should execute email step', async () => {
      const workflow: Workflow = {
        name: 'test-email',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'email',
            to: 'user@example.com',
            subject: 'Welcome',
            body: 'Welcome to our platform!',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      await executor.execute(workflow, context)

      expect(mockEmailService.send).toHaveBeenCalledWith(
        'user@example.com',
        'Welcome',
        'Welcome to our platform!',
        undefined
      )
    })

    it('should throw error when email service not configured', async () => {
      const executorNoEmail = new WorkflowExecutor({
        dataLayer: mockDataLayer,
      })

      const workflow: Workflow = {
        name: 'test-email',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'email',
            to: 'user@example.com',
            subject: 'Test',
            body: 'Test',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executorNoEmail.execute(workflow, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Email service not configured')
    })
  })

  describe('multi-step workflows', () => {
    it('should execute multiple steps in sequence', async () => {
      const workflow: Workflow = {
        name: 'test-multi-step',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'query',
            entity: 'user',
            action: 'create',
            data: { name: 'John' },
            assignTo: 'newUser',
          },
          {
            type: 'webhook',
            url: 'https://api.example.com/notify',
            method: 'POST',
            payload: { userId: '{{variables.newUser.id}}' },
          },
          {
            type: 'email',
            to: 'admin@example.com',
            subject: 'New user created',
            body: 'User {{variables.newUser.id}} was created',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(true)
      expect(mockDataLayer.create).toHaveBeenCalled()
      expect(mockHttpClient.request).toHaveBeenCalled()
      expect(mockEmailService.send).toHaveBeenCalled()
    })

    it('should stop on first error', async () => {
      mockDataLayer.create = vi.fn().mockRejectedValue(new Error('Database error'))

      const workflow: Workflow = {
        name: 'test-error',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'query',
            entity: 'user',
            action: 'create',
            data: { name: 'John' },
          },
          {
            type: 'webhook',
            url: 'https://api.example.com/notify',
            method: 'POST',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Database error')
      expect(mockDataLayer.create).toHaveBeenCalled()
      expect(mockHttpClient.request).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should include logs in successful result', async () => {
      const workflow: Workflow = {
        name: 'test-logs',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/test',
            method: 'GET',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.logs.length).toBeGreaterThan(0)
      expect(result.logs.some(log => log.message.includes('Starting workflow'))).toBe(true)
      expect(result.logs.some(log => log.message.includes('Workflow completed'))).toBe(true)
    })

    it('should include error logs in failed result', async () => {
      mockHttpClient.request = vi.fn().mockRejectedValue(new Error('HTTP error'))

      const workflow: Workflow = {
        name: 'test-error-logs',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/test',
            method: 'POST',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(false)
      expect(result.logs.some(log => log.level === 'error')).toBe(true)
      expect(result.logs.some(log => log.message.includes('HTTP error'))).toBe(true)
    })

    it('should validate webhook step requirements', async () => {
      const workflow: Workflow = {
        name: 'test-validation',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            method: 'POST',
            // Missing url
          } as any,
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Webhook step requires url')
    })

    it('should validate query step requirements', async () => {
      const workflow: Workflow = {
        name: 'test-validation',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'query',
            entity: 'user',
            // Missing action
          } as any,
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Query step requires action')
    })

    it('should validate email step requirements', async () => {
      const workflow: Workflow = {
        name: 'test-validation',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'email',
            to: 'user@example.com',
            // Missing subject
          } as any,
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Email step requires subject')
    })
  })

  describe('context and variable management', () => {
    it('should initialize empty variables if not present', async () => {
      const workflow: Workflow = {
        name: 'test-init',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/test',
            method: 'GET',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        // No variables
      } as any

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(true)
      expect(context.variables).toBeDefined()
    })

    it('should assign step results to variables', async () => {
      const workflow: Workflow = {
        name: 'test-assign',
        trigger: { entity: 'user', event: 'create' },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/data',
            method: 'GET',
            assignTo: 'apiResponse',
          },
        ],
      }

      const context: WorkflowContext = {
        trigger: { type: 'entity', entity: 'user', event: 'create' },
        variables: {},
      }

      const result = await executor.execute(workflow, context)

      expect(result.success).toBe(true)
      expect(context.variables.apiResponse).toEqual({ success: true, data: 'response' })
      expect(result.result.apiResponse).toEqual({ success: true, data: 'response' })
    })
  })
})
