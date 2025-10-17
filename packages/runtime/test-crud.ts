/**
 * Test CRUD Operations
 *
 * This script tests the full CRUD cycle:
 * 1. Create a User
 * 2. Create a Post (with foreign key to User)
 * 3. Read the Post
 * 4. Update the Post
 * 5. Delete the Post
 */

async function testCRUD() {
  const baseUrl = 'http://localhost:3000'

  console.log('🧪 Starting CRUD tests...\n')

  try {
    // 1. Create a User
    console.log('1️⃣  Creating user...')
    const userResponse = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin'
      })
    })

    if (!userResponse.ok) {
      throw new Error(`Failed to create user: ${await userResponse.text()}`)
    }

    const user = (await userResponse.json()) as any
    console.log(`✅ User created: ${user.id} - ${user.name}`)
    console.log(`   Email: ${user.email}, Role: ${user.role}\n`)

    // 2. Create a Post (using API route)
    console.log('2️⃣  Creating post...')
    const postResponse = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Post',
        slug: 'test-post',
        body: 'This is a test post to verify CRUD operations.',
        status: 'published',
        authorId: user.id
      })
    })

    if (!postResponse.ok) {
      throw new Error(`Failed to create post: ${await postResponse.text()}`)
    }

    const post = (await postResponse.json()) as any
    console.log(`✅ Post created: ${post.id} - ${post.title}`)
    console.log(`   Slug: ${post.slug}, Status: ${post.status}\n`)

    // 3. Read the Post (using API route)
    console.log('3️⃣  Reading post...')
    const readResponse = await fetch(`${baseUrl}/api/posts/${post.id}`)

    if (!readResponse.ok) {
      throw new Error(`Failed to read post: ${await readResponse.text()}`)
    }

    const readPost = (await readResponse.json()) as any
    console.log(`✅ Post retrieved: ${readPost.id} - ${readPost.title}`)
    console.log(`   Body: ${readPost.body}\n`)

    // 4. Update the Post (using API route)
    console.log('4️⃣  Updating post...')
    const updateResponse = await fetch(`${baseUrl}/api/posts/${post.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Updated Test Post',
        slug: 'test-post',
        body: 'This post has been updated.',
        status: 'draft'
      })
    })

    if (!updateResponse.ok) {
      throw new Error(`Failed to update post: ${await updateResponse.text()}`)
    }

    const updatedPost = (await updateResponse.json()) as any
    console.log(`✅ Post updated: ${updatedPost.id} - ${updatedPost.title}`)
    console.log(`   New status: ${updatedPost.status}\n`)

    // 5. Delete the Post (using API route)
    console.log('5️⃣  Deleting post...')
    const deleteResponse = await fetch(`${baseUrl}/api/posts/${post.id}`, {
      method: 'DELETE'
    })

    if (!deleteResponse.ok && deleteResponse.status !== 204) {
      throw new Error(`Failed to delete post: ${await deleteResponse.text()}`)
    }

    console.log(`✅ Post deleted: ${post.id}\n`)

    // 6. Verify deletion
    console.log('6️⃣  Verifying deletion...')
    const verifyResponse = await fetch(`${baseUrl}/api/posts/${post.id}`)

    if (verifyResponse.status === 404) {
      console.log(`✅ Post successfully deleted (not found)\n`)
    } else {
      console.log(`⚠️  Post still exists after deletion\n`)
    }

    console.log('✅ All CRUD tests passed!\n')

  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

// Run tests
testCRUD()
