# Building AI Tools with Zebric

Zebric's declarative, configuration-driven approach makes it ideal for building AI-powered tools. This guide covers how to leverage Zebric's Blueprint format to create applications that integrate with LLMs, AI agents, and other AI services.

## Why Zebric for AI Tools?

Zebric provides several advantages when building AI-integrated applications:

- **LLM-friendly configuration**: Blueprint files are designed to be easily generated and modified by LLMs
- **Rapid iteration**: Runtime interpretation means changes take effect immediately without recompilation
- **Extensible behaviors**: Custom logic hooks for AI processing without abandoning the declarative approach
- **Built-in data management**: Automatic database schema and CRUD operations for storing AI interactions
- **Authentication ready**: Secure user sessions and access control out of the box

## Common AI Tool Patterns

### 1. AI Chat Interface

A conversational interface that stores chat history and integrates with LLM APIs.

**Entity Design:**

```toml
[entity.Conversation]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "userId", type = "Ref", ref = "User.id", required = true },
  { name = "model", type = "Text", default = "gpt-4" },
  { name = "systemPrompt", type = "LongText" },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[entity.Conversation.relations]
messages = { type = "hasMany", entity = "Message", foreign_key = "conversationId" }
user = { type = "belongsTo", entity = "User", foreign_key = "userId" }

[entity.Message]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "conversationId", type = "Ref", ref = "Conversation.id", required = true },
  { name = "role", type = "Enum", values = ["user", "assistant", "system"] },
  { name = "content", type = "LongText", required = true },
  { name = "tokens", type = "Integer" },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[entity.Message.relations]
conversation = { type = "belongsTo", entity = "Conversation", foreign_key = "conversationId" }
```

**Page Configuration:**

```toml
[page."/conversations/:id"]
title = "Chat"
auth = "required"
layout = "detail"

[page."/conversations/:id".query.conversation]
entity = "Conversation"
where = { id = "$params.id", userId = "$currentUser.id" }

[page."/conversations/:id".query.messages]
entity = "Message"
where = { conversationId = "$params.id" }
orderBy = { createdAt = "asc" }
include = []

[page."/conversations/:id".form]
entity = "Message"
method = "create"
behavior = "behaviors/chat/send-message.js"

[[page."/conversations/:id".form.fields]]
name = "content"
type = "textarea"
label = "Message"
required = true
rows = 3

[page."/conversations/:id".form.onSuccess]
redirect = "/conversations/{conversationId}"
```

**Behavior Implementation:**

Create `behaviors/chat/send-message.js`:

```javascript
export default async function sendMessage(context) {
  const { formData, currentUser, params, db } = context;

  // Save user message
  const userMessage = await db.insert('Message', {
    conversationId: params.id,
    role: 'user',
    content: formData.content,
    createdAt: new Date()
  });

  // Get conversation context
  const conversation = await db.findOne('Conversation', { id: params.id });
  const messages = await db.findMany('Message', {
    where: { conversationId: params.id },
    orderBy: { createdAt: 'asc' }
  });

  // Call AI API (example with OpenAI)
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: conversation.model,
      messages: [
        ...(conversation.systemPrompt ? [{ role: 'system', content: conversation.systemPrompt }] : []),
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ]
    })
  });

  const data = await response.json();
  const assistantMessage = data.choices[0].message;

  // Save AI response
  await db.insert('Message', {
    conversationId: params.id,
    role: 'assistant',
    content: assistantMessage.content,
    tokens: data.usage.completion_tokens,
    createdAt: new Date()
  });

  return {
    success: true,
    data: { conversationId: params.id }
  };
}
```

### 2. Document Processing Pipeline

Process uploaded documents with AI analysis and extraction.

**Entity Design:**

```toml
[entity.Document]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "userId", type = "Ref", ref = "User.id", required = true },
  { name = "filename", type = "Text", required = true },
  { name = "mimeType", type = "Text" },
  { name = "size", type = "Integer" },
  { name = "status", type = "Enum", values = ["uploaded", "processing", "completed", "failed"], default = "uploaded" },
  { name = "storageUrl", type = "Text" },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[entity.Document.relations]
analyses = { type = "hasMany", entity = "Analysis", foreign_key = "documentId" }

[entity.Analysis]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "documentId", type = "Ref", ref = "Document.id", required = true },
  { name = "type", type = "Enum", values = ["summary", "entities", "sentiment", "topics"] },
  { name = "result", type = "JSON" },
  { name = "confidence", type = "Float" },
  { name = "model", type = "Text" },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[entity.Analysis.relations]
document = { type = "belongsTo", entity = "Document", foreign_key = "documentId" }
```

**Upload and Processing Page:**

```toml
[page."/documents/upload"]
title = "Upload Document"
auth = "required"
layout = "form"
behavior = "behaviors/documents/upload-and-analyze.js"

[page."/documents/upload".form]
entity = "Document"
method = "create"

[[page."/documents/upload".form.fields]]
name = "file"
type = "file"
label = "Document"
accept = ".pdf,.txt,.docx"
required = true

[[page."/documents/upload".form.fields]]
name = "analysisTypes"
type = "checkbox"
label = "Analysis Types"
options = ["summary", "entities", "sentiment", "topics"]

[page."/documents/upload".form.onSuccess]
redirect = "/documents/{id}"
message = "Document uploaded and queued for analysis"
```

### 3. AI-Generated Content Management

Create and manage AI-generated articles, images, or other content.

**Entity Design:**

```toml
[entity.GeneratedContent]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "userId", type = "Ref", ref = "User.id", required = true },
  { name = "type", type = "Enum", values = ["article", "image", "video", "code"], required = true },
  { name = "prompt", type = "LongText", required = true },
  { name = "parameters", type = "JSON" },
  { name = "content", type = "LongText" },
  { name = "url", type = "Text" },
  { name = "status", type = "Enum", values = ["pending", "generating", "completed", "failed"], default = "pending" },
  { name = "model", type = "Text" },
  { name = "tokensUsed", type = "Integer" },
  { name = "cost", type = "Float" },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[entity.GeneratedContent.relations]
user = { type = "belongsTo", entity = "User", foreign_key = "userId" }
revisions = { type = "hasMany", entity = "ContentRevision", foreign_key = "contentId" }

[entity.ContentRevision]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "contentId", type = "Ref", ref = "GeneratedContent.id", required = true },
  { name = "prompt", type = "LongText", required = true },
  { name = "content", type = "LongText" },
  { name = "createdAt", type = "DateTime", default = "now" }
]
```

### 4. AI Agent Workflow System

Build multi-step AI workflows with conditional logic.

**Entity Design:**

```toml
[entity.Workflow]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "name", type = "Text", required = true },
  { name = "description", type = "LongText" },
  { name = "steps", type = "JSON", required = true },
  { name = "userId", type = "Ref", ref = "User.id", required = true },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[entity.WorkflowRun]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "workflowId", type = "Ref", ref = "Workflow.id", required = true },
  { name = "status", type = "Enum", values = ["queued", "running", "completed", "failed"], default = "queued" },
  { name = "input", type = "JSON" },
  { name = "output", type = "JSON" },
  { name = "currentStep", type = "Integer", default = 0 },
  { name = "error", type = "LongText" },
  { name = "startedAt", type = "DateTime" },
  { name = "completedAt", type = "DateTime" },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[entity.WorkflowRun.relations]
workflow = { type = "belongsTo", entity = "Workflow", foreign_key = "workflowId" }
stepResults = { type = "hasMany", entity = "StepResult", foreign_key = "runId" }

[entity.StepResult]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "runId", type = "Ref", ref = "WorkflowRun.id", required = true },
  { name = "stepIndex", type = "Integer", required = true },
  { name = "stepName", type = "Text" },
  { name = "input", type = "JSON" },
  { name = "output", type = "JSON" },
  { name = "error", type = "LongText" },
  { name = "tokensUsed", type = "Integer" },
  { name = "duration", type = "Integer" },
  { name = "createdAt", type = "DateTime", default = "now" }
]
```

## Best Practices

### 1. Separate AI Logic from Blueprint

Keep your Blueprint focused on data models and page structure. Move AI-specific logic into behaviors:

```
project/
├── blueprint.toml
├── behaviors/
│   ├── ai/
│   │   ├── chat.js
│   │   ├── summarize.js
│   │   └── analyze.js
│   └── workflows/
│       └── agent-runner.js
```

### 2. Track Usage and Costs

Always store metadata about AI API calls:

```toml
[entity.AIUsage]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "userId", type = "Ref", ref = "User.id" },
  { name = "model", type = "Text", required = true },
  { name = "provider", type = "Text", required = true },
  { name = "operation", type = "Text" },
  { name = "inputTokens", type = "Integer" },
  { name = "outputTokens", type = "Integer" },
  { name = "totalTokens", type = "Integer" },
  { name = "cost", type = "Float" },
  { name = "createdAt", type = "DateTime", default = "now" }
]
```

### 3. Implement Rate Limiting

Use access control rules to prevent abuse:

```toml
[entity.Message.access]
create = { "$currentUser.dailyMessageCount" = { lt = 100 } }
```

Or implement custom rate limiting in behaviors:

```javascript
export default async function checkRateLimit(context) {
  const { currentUser, db } = context;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const count = await db.count('Message', {
    where: {
      userId: currentUser.id,
      createdAt: { gte: today }
    }
  });

  if (count >= 100) {
    return {
      success: false,
      error: 'Daily message limit reached'
    };
  }

  // Continue with normal processing
  return { success: true };
}
```

### 4. Handle Async Processing

For long-running AI tasks, use background jobs:

```javascript
import { Queue } from 'bullmq';

const aiQueue = new Queue('ai-processing', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  }
});

export default async function queueAnalysis(context) {
  const { formData, db } = context;

  // Create document record
  const document = await db.insert('Document', {
    ...formData,
    status: 'processing'
  });

  // Queue background job
  await aiQueue.add('analyze-document', {
    documentId: document.id,
    analysisTypes: formData.analysisTypes
  });

  return {
    success: true,
    data: { id: document.id }
  };
}
```

### 5. Implement Streaming Responses

For real-time AI responses, use custom behaviors with streaming:

```javascript
export default async function streamChat(context) {
  const { formData, params, response } = context;

  // Set up SSE headers
  response.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Stream AI response
  const stream = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: formData.content }],
    stream: true
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    response.raw.write(`data: ${JSON.stringify({ content })}\n\n`);
  }

  response.raw.end();
}
```

### 6. Version Your Prompts

Store prompt templates as entities for easy iteration:

```toml
[entity.PromptTemplate]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "name", type = "Text", required = true, unique = true },
  { name = "version", type = "Integer", default = 1 },
  { name = "template", type = "LongText", required = true },
  { name = "variables", type = "JSON" },
  { name = "model", type = "Text" },
  { name = "temperature", type = "Float", default = 0.7 },
  { name = "maxTokens", type = "Integer" },
  { name = "isActive", type = "Boolean", default = true },
  { name = "createdAt", type = "DateTime", default = "now" }
]
```

## Environment Configuration

Store API keys and configuration in `.env`:

```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4

# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Google AI
GOOGLE_AI_API_KEY=...
GOOGLE_AI_MODEL=gemini-pro

# Rate limiting
REDIS_HOST=localhost
REDIS_PORT=6379
```

Access in behaviors:

```javascript
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4';
```

## Security Considerations

### 1. Sanitize AI Inputs

Always validate and sanitize user inputs before sending to AI APIs:

```javascript
function sanitizePrompt(input) {
  // Remove potential injection attempts
  return input
    .replace(/system:/gi, '')
    .replace(/assistant:/gi, '')
    .trim()
    .substring(0, 10000); // Limit length
}
```

### 2. Protect API Keys

Never expose API keys to the client. Use behaviors to handle all AI API calls server-side.

### 3. Implement Content Filtering

Filter both inputs and outputs for inappropriate content:

```javascript
export default async function moderateContent(context) {
  const { formData } = context;

  const moderation = await openai.moderations.create({
    input: formData.content
  });

  if (moderation.results[0].flagged) {
    return {
      success: false,
      error: 'Content violates usage policies'
    };
  }

  // Continue processing
  return { success: true };
}
```

### 4. User Isolation

Ensure users can only access their own AI-generated content:

```toml
[entity.GeneratedContent.access]
read = { userId = "$currentUser.id" }
update = { userId = "$currentUser.id" }
delete = { userId = "$currentUser.id" }
```

## Example: Complete AI Writing Assistant

Here's a complete blueprint for an AI writing assistant:

```toml
version = "0.1.0"

[project]
name = "AI Writing Assistant"
version = "1.0.0"
description = "AI-powered content generation and editing"

[project.runtime]
min_version = "0.1.0"

# Entities
[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email", unique = true, required = true },
  { name = "name", type = "Text", required = true },
  { name = "tokensUsed", type = "Integer", default = 0 },
  { name = "plan", type = "Enum", values = ["free", "pro"], default = "free" },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[entity.Document]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "userId", type = "Ref", ref = "User.id", required = true },
  { name = "title", type = "Text", required = true },
  { name = "content", type = "LongText" },
  { name = "genre", type = "Enum", values = ["blog", "article", "story", "email", "social"] },
  { name = "tone", type = "Enum", values = ["professional", "casual", "friendly", "formal"] },
  { name = "createdAt", type = "DateTime", default = "now" },
  { name = "updatedAt", type = "DateTime", default = "now" }
]

[entity.Document.relations]
generations = { type = "hasMany", entity = "Generation", foreign_key = "documentId" }

[entity.Generation]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "documentId", type = "Ref", ref = "Document.id", required = true },
  { name = "prompt", type = "LongText", required = true },
  { name = "output", type = "LongText" },
  { name = "model", type = "Text" },
  { name = "tokensUsed", type = "Integer" },
  { name = "rating", type = "Integer" },
  { name = "createdAt", type = "DateTime", default = "now" }
]

# Pages
[page."/"]
title = "Dashboard"
auth = "required"
layout = "dashboard"

[page."/".query.documents]
entity = "Document"
where = { userId = "$currentUser.id" }
orderBy = { updatedAt = "desc" }
limit = 10

[page."/documents/new"]
title = "New Document"
auth = "required"
layout = "form"

[page."/documents/new".form]
entity = "Document"
method = "create"

[[page."/documents/new".form.fields]]
name = "title"
type = "text"
label = "Title"
required = true

[[page."/documents/new".form.fields]]
name = "genre"
type = "select"
label = "Genre"
options = ["blog", "article", "story", "email", "social"]
required = true

[[page."/documents/new".form.fields]]
name = "tone"
type = "select"
label = "Tone"
options = ["professional", "casual", "friendly", "formal"]
required = true

[page."/documents/new".form.onSuccess]
redirect = "/documents/{id}"
message = "Document created!"

[page."/documents/:id"]
title = "Edit Document"
auth = "required"
layout = "detail"

[page."/documents/:id".query.document]
entity = "Document"
where = { id = "$params.id", userId = "$currentUser.id" }

[page."/documents/:id".query.generations]
entity = "Generation"
where = { documentId = "$params.id" }
orderBy = { createdAt = "desc" }
limit = 5

[page."/documents/:id/generate"]
title = "Generate Content"
auth = "required"
layout = "form"
behavior = "behaviors/ai/generate-content.js"

[page."/documents/:id/generate".form]
entity = "Generation"
method = "create"

[[page."/documents/:id/generate".form.fields]]
name = "prompt"
type = "textarea"
label = "What would you like to write?"
required = true
rows = 5

[page."/documents/:id/generate".form.onSuccess]
redirect = "/documents/{documentId}"
message = "Content generated!"

# Auth
[auth]
providers = ["email"]
trustedOrigins = ["http://localhost:3000"]

# UI
[ui]
render_mode = "server"
theme = "default"
```

## Next Steps

- Explore the [Blueprint Specification](blueprint-specification.md) for complete configuration options
- Review [Zebric Engine Architecture](Zebric-Engine-Architecture.md) for understanding the runtime
- Check out example behaviors in the `examples/` directory
- Read about [Custom Plugins](../packages/plugin-sdk/README.md) for advanced extensibility

## Resources

- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Anthropic Claude API](https://docs.anthropic.com/)
- [Google AI Documentation](https://ai.google.dev/)
- [LangChain](https://www.langchain.com/) - Framework for building AI applications
- [Vercel AI SDK](https://sdk.vercel.ai/) - Toolkit for AI-powered streaming UIs
