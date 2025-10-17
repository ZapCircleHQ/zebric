/**
 * Data Fixtures
 *
 * Seed data generators for integration tests
 */

/**
 * Generate sample user data
 */
export function generateUsers(count: number = 3) {
  return Array.from({ length: count }, (_, i) => ({
    email: `user${i + 1}@example.com`,
    name: `User ${i + 1}`,
    role: i === 0 ? 'admin' : 'user',
  }))
}

/**
 * Generate sample product data
 */
export function generateProducts(count: number = 5) {
  const products = [
    { name: 'Laptop', price: 999.99, description: 'High-performance laptop', inStock: true },
    { name: 'Mouse', price: 29.99, description: 'Wireless mouse', inStock: true },
    { name: 'Keyboard', price: 79.99, description: 'Mechanical keyboard', inStock: true },
    { name: 'Monitor', price: 299.99, description: '27-inch 4K monitor', inStock: false },
    { name: 'Headphones', price: 149.99, description: 'Noise-canceling headphones', inStock: true },
  ]

  return products.slice(0, count)
}

/**
 * Generate sample author data
 */
export function generateAuthors(count: number = 3) {
  return Array.from({ length: count }, (_, i) => ({
    name: `Author ${i + 1}`,
    email: `author${i + 1}@example.com`,
  }))
}

/**
 * Generate sample blog post data
 */
export function generatePosts(authorIds: string[], count: number = 5) {
  const posts = [
    {
      title: 'Getting Started with ZBL',
      content: 'This is a comprehensive guide to getting started with ZBL engine...',
      published: true,
    },
    {
      title: 'Advanced ZBL Features',
      content: 'Learn about advanced features like workflows and plugins...',
      published: true,
    },
    {
      title: 'ZBL Best Practices',
      content: 'Follow these best practices for building production apps...',
      published: false,
    },
    {
      title: 'ZBL Security Guide',
      content: 'Security considerations when building with ZBL...',
      published: true,
    },
    {
      title: 'ZBL Performance Tips',
      content: 'Optimize your ZBL applications for maximum performance...',
      published: false,
    },
  ]

  return posts.slice(0, count).map((post, i) => ({
    ...post,
    authorId: authorIds[i % authorIds.length],
  }))
}

/**
 * Generate sample comment data
 */
export function generateComments(postIds: string[], authorIds: string[], count: number = 10) {
  const comments = [
    'Great article! Very helpful.',
    'Thanks for sharing this.',
    'I have a question about this...',
    'This solved my problem!',
    'Could you elaborate more on this topic?',
    'Awesome content!',
    'I disagree with this approach.',
    'This is exactly what I needed.',
    'Very well explained.',
    'Looking forward to more posts like this.',
  ]

  return comments.slice(0, count).map((content, i) => ({
    content,
    postId: postIds[i % postIds.length],
    authorId: authorIds[i % authorIds.length],
  }))
}

/**
 * Generate sample category data
 */
export function generateCategories(count: number = 4) {
  const categories = [
    { name: 'Electronics', description: 'Electronic devices and accessories' },
    { name: 'Computers', description: 'Computers and computer accessories' },
    { name: 'Audio', description: 'Audio equipment and accessories' },
    { name: 'Accessories', description: 'Various tech accessories' },
  ]

  return categories.slice(0, count)
}

/**
 * Generate sample order data
 */
export function generateOrders(userIds: string[], productIds: string[], count: number = 3) {
  const statuses = ['pending', 'processing', 'shipped', 'delivered']

  return Array.from({ length: count }, (_, i) => ({
    userId: userIds[i % userIds.length],
    status: statuses[i % statuses.length],
    total: (i + 1) * 100.0,
    items: [
      {
        productId: productIds[i % productIds.length],
        quantity: i + 1,
        price: 100.0,
      },
    ],
  }))
}

/**
 * Generate sample profile data
 */
export function generateProfiles(userIds: string[], count?: number) {
  const ids = count ? userIds.slice(0, count) : userIds

  return ids.map((userId, i) => ({
    userId,
    publicName: `Public User ${i + 1}`,
    privateEmail: `private${i + 1}@example.com`,
    internalNotes: `Internal notes for user ${i + 1}`,
  }))
}

/**
 * Create a test user with auth credentials
 */
export function createTestUser(role: string = 'user') {
  const timestamp = Date.now()
  return {
    email: `test-${timestamp}@example.com`,
    password: 'Test123!@#',
    name: `Test User ${timestamp}`,
    role,
  }
}

/**
 * Create multiple test users with auth credentials
 */
export function createTestUsers(roles: string[] = ['admin', 'editor', 'viewer']) {
  return roles.map((role) => createTestUser(role))
}

/**
 * Generate minimal entity data for testing
 */
export function generateMinimalEntity() {
  return {
    name: 'Test Entity',
  }
}

/**
 * Generate entity with all field types
 */
export function generateComplexEntity() {
  return {
    stringField: 'test string',
    numberField: 42,
    booleanField: true,
    dateField: new Date().toISOString(),
    jsonField: { nested: { data: 'value' } },
    arrayField: ['item1', 'item2', 'item3'],
  }
}
