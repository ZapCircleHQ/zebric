/**
 * Blueprint Fixtures
 *
 * Reusable blueprint configurations for integration tests
 */

/**
 * Minimal blueprint with no entities
 * For basic engine startup tests
 */
export function basicBlueprint() {
  return {
    name: 'test-app',
    version: '1.0.0',
    entities: {},
  }
}

/**
 * Blueprint with a simple entity
 * For CRUD operation tests
 */
export function simpleEntityBlueprint() {
  return {
    name: 'test-app',
    version: '1.0.0',
    entities: {
      product: {
        fields: {
          name: {
            type: 'string',
            required: true,
          },
          price: {
            type: 'number',
            required: true,
          },
          description: {
            type: 'string',
            required: false,
          },
          inStock: {
            type: 'boolean',
            default: true,
          },
        },
      },
    },
  }
}

/**
 * Blueprint with authentication enabled
 * For auth flow tests
 */
export function authBlueprint() {
  return {
    name: 'test-app',
    version: '1.0.0',
    auth: {
      enabled: true,
      providers: ['email'],
    },
    entities: {
      user: {
        fields: {
          email: {
            type: 'string',
            required: true,
            unique: true,
          },
          name: {
            type: 'string',
            required: true,
          },
        },
      },
    },
  }
}

/**
 * Blueprint with roles and permissions
 * For authorization tests
 */
export function authorizationBlueprint() {
  return {
    name: 'test-app',
    version: '1.0.0',
    auth: {
      enabled: true,
      providers: ['email'],
    },
    roles: {
      admin: {
        permissions: ['*'],
      },
      editor: {
        permissions: ['product:read', 'product:create', 'product:update'],
      },
      viewer: {
        permissions: ['product:read'],
      },
    },
    entities: {
      user: {
        fields: {
          email: {
            type: 'string',
            required: true,
            unique: true,
          },
          name: {
            type: 'string',
            required: true,
          },
          role: {
            type: 'string',
            required: true,
            default: 'viewer',
          },
        },
      },
      product: {
        fields: {
          name: {
            type: 'string',
            required: true,
          },
          price: {
            type: 'number',
            required: true,
          },
          createdBy: {
            type: 'relation',
            entity: 'user',
            required: false,
          },
        },
        permissions: {
          read: ['viewer', 'editor', 'admin'],
          create: ['editor', 'admin'],
          update: ['editor', 'admin'],
          delete: ['admin'],
        },
      },
    },
  }
}

/**
 * Blueprint with field-level access control
 * For field-level security tests
 */
export function fieldLevelAccessBlueprint() {
  return {
    name: 'test-app',
    version: '1.0.0',
    auth: {
      enabled: true,
      providers: ['email'],
    },
    roles: {
      admin: {
        permissions: ['*'],
      },
      user: {
        permissions: ['profile:read', 'profile:update'],
      },
    },
    entities: {
      user: {
        fields: {
          email: {
            type: 'string',
            required: true,
            unique: true,
          },
          name: {
            type: 'string',
            required: true,
          },
          role: {
            type: 'string',
            required: true,
            default: 'user',
          },
        },
      },
      profile: {
        fields: {
          userId: {
            type: 'relation',
            entity: 'user',
            required: true,
          },
          publicName: {
            type: 'string',
            required: true,
            access: {
              read: ['user', 'admin'],
              write: ['user', 'admin'],
            },
          },
          privateEmail: {
            type: 'string',
            required: true,
            access: {
              read: ['admin'],
              write: ['admin'],
            },
          },
          internalNotes: {
            type: 'string',
            required: false,
            access: {
              read: ['admin'],
              write: ['admin'],
            },
          },
        },
      },
    },
  }
}

/**
 * Blueprint with relationships
 * For relational data tests
 */
export function relationalBlueprint() {
  return {
    name: 'test-app',
    version: '1.0.0',
    entities: {
      author: {
        fields: {
          name: {
            type: 'string',
            required: true,
          },
          email: {
            type: 'string',
            required: true,
            unique: true,
          },
        },
      },
      post: {
        fields: {
          title: {
            type: 'string',
            required: true,
          },
          content: {
            type: 'text',
            required: true,
          },
          authorId: {
            type: 'relation',
            entity: 'author',
            required: true,
          },
          published: {
            type: 'boolean',
            default: false,
          },
        },
      },
      comment: {
        fields: {
          postId: {
            type: 'relation',
            entity: 'post',
            required: true,
          },
          authorId: {
            type: 'relation',
            entity: 'author',
            required: true,
          },
          content: {
            type: 'text',
            required: true,
          },
        },
      },
    },
  }
}

/**
 * Full e-commerce blueprint
 * For complex integration tests
 */
export function ecommerceBlueprint() {
  return {
    name: 'ecommerce-app',
    version: '1.0.0',
    auth: {
      enabled: true,
      providers: ['email'],
    },
    roles: {
      admin: {
        permissions: ['*'],
      },
      customer: {
        permissions: ['product:read', 'order:create', 'order:read'],
      },
    },
    entities: {
      user: {
        fields: {
          email: {
            type: 'string',
            required: true,
            unique: true,
          },
          name: {
            type: 'string',
            required: true,
          },
          role: {
            type: 'string',
            required: true,
            default: 'customer',
          },
        },
      },
      category: {
        fields: {
          name: {
            type: 'string',
            required: true,
            unique: true,
          },
          description: {
            type: 'text',
            required: false,
          },
        },
      },
      product: {
        fields: {
          name: {
            type: 'string',
            required: true,
          },
          description: {
            type: 'text',
            required: false,
          },
          price: {
            type: 'number',
            required: true,
          },
          categoryId: {
            type: 'relation',
            entity: 'category',
            required: false,
          },
          inStock: {
            type: 'boolean',
            default: true,
          },
          inventory: {
            type: 'number',
            default: 0,
          },
        },
      },
      order: {
        fields: {
          userId: {
            type: 'relation',
            entity: 'user',
            required: true,
          },
          status: {
            type: 'string',
            required: true,
            default: 'pending',
          },
          total: {
            type: 'number',
            required: true,
          },
          items: {
            type: 'json',
            required: true,
          },
        },
        permissions: {
          read: ['customer', 'admin'],
          create: ['customer', 'admin'],
          update: ['admin'],
          delete: ['admin'],
        },
      },
    },
  }
}

/**
 * Blueprint with workflows
 * For workflow integration tests
 */
export function workflowBlueprint() {
  return {
    name: 'test-app',
    version: '1.0.0',
    entities: {
      order: {
        fields: {
          customerEmail: {
            type: 'string',
            required: true,
          },
          status: {
            type: 'string',
            required: true,
            default: 'pending',
          },
          total: {
            type: 'number',
            required: true,
          },
        },
      },
    },
    workflows: [
      {
        name: 'order-created',
        trigger: {
          entity: 'order',
          event: 'create',
        },
        steps: [
          {
            type: 'webhook',
            url: 'https://api.example.com/notify',
            method: 'POST',
            payload: {
              orderId: '{{trigger.data.id}}',
              customerEmail: '{{trigger.data.customerEmail}}',
              total: '{{trigger.data.total}}',
            },
          },
        ],
      },
    ],
  }
}
