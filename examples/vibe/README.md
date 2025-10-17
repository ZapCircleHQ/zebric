# Vibe Chat Blueprint Example

A chat-led Zebric example that turns natural language prompts into `blueprint.toml` files by calling OpenAI. It combines the Blueprint spec from `ZBL-Framework-Specification.md` with the hot-reload workflow described in `docs/quickstart.md`.

## Highlights
- **Zero-auth chat** – create a session and iterate with a friendly composer UI.
- **Workflow → OpenAI** – the `generate_vibe_blueprint` workflow listens for new `ChatMessage` records, calls the OpenAI Chat Completions API with your `OPENAI_API_KEY`, and stores the assistant response as a blueprint.
- **Inline preview** – a custom behavior renders the conversation, shows the generated TOML, and embeds an iframe preview so you can inspect the artifact without leaving the page.

## Running the example

```bash
# 1. Install dependencies once
pnpm install

# 2. Export your OpenAI API key (required by the workflow)
export OPENAI_API_KEY=sk-...

# 3. Launch the engine pointing at the example blueprint
pnpm exec zbl-engine --blueprint=examples/vibe/blueprint.toml
```

Open http://localhost:3000/sessions/new to start a new “vibe”. After you submit a prompt, the workflow posts to OpenAI and streams the generated `blueprint.toml` back into the chat.

## How it works
- **Entities**: `ChatSession` tracks the conversation, `ChatMessage` stores both user prompts and assistant blueprints.
- **Workflow**: `generate_vibe_blueprint` updates the session status, calls `https://api.openai.com/v1/chat/completions`, and records the response as an assistant message.
- **Behavior**: `behaviors/chat-render.js` builds a two-pane layout (chat + blueprint preview) and handles posting new messages to `/api/chat-messages`.

From here you can iterate on the behavior or workflow to handle retries, multi-turn prompts, or deployment provider hints in the generated blueprint.

