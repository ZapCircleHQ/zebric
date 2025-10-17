# Zebric Quickstart

Get from idea to a running Zebric application in minutes by pairing an LLM-generated `blueprint.toml` with the runtime engine.

## Prerequisites

- Node.js 20 or newer
- `pnpm` 8.x
- Access to an LLM that can follow structured prompts (ChatGPT, Claude, Gemini, etc.)

## 1. Prompt an LLM to Generate `blueprint.toml`

Start the conversation by pasting the following prompt. Adjust the app description as needed:

```
You are an expert Zebric Blueprint author. Produce a complete `blueprint.toml`
for a {describe your app here}.

Requirements:
- Follow the Zebric Blueprint specification
- Define entities with realistic field names and data types
- Include at least one page per major workflow
- For pages that need custom logic, declare a behavior but leave implementation paths empty
- Use `auth = "optional"` where anonymous access is acceptable
- Include helpful comments sparingly
- Return only valid TOML
```

Tips while iterating with the LLM:

- Ask it to refine entities or page flows rather than rewriting from scratch.
- Have it add relationships with `where` clauses (`[page."/tasks/:id".queries.task]` patterns).
- Keep behavior file paths consistent so you can add implementations later.

## 2. Review and Save the Blueprint

1. Paste the generated TOML into `blueprint.toml`.
2. Skim the file for:
   - Correct entity names and field types.
   - Query definitions referencing valid fields.
   - Optional authentication set where desired.
3. Run `pnpm exec zbl validate --blueprint=blueprint.toml` to catch schema or reference errors before starting the engine.
4. Commit or back up the blueprint so you can track changes between LLM iterations.

If validation fails, the CLI will list each issue so you can correct them before you run the runtime.

## 3. Run the Zebric Runtime

From the project directory that contains `blueprint.toml`:

```bash
# Install dependencies once
pnpm install

# Launch the runtime (defaults to http://localhost:3000)
pnpm exec zebric --blueprint=blueprint.toml
```

The CLI will create the SQLite database on first run, sync the schema defined in your blueprint, and start the Fastify server.

### Hot Reload

Leave the process running while you iterate. Updating `blueprint.toml` triggers a reload—no restart required.

## 4. Explore and Validate

- Visit `http://localhost:3000` (or any defined page path) to see the rendered HTML.
- Use `curl` or your browser dev tools to inspect JSON responses by sending `Accept: application/json`.
- Verify form workflows, access controls, and any behavior hooks you declared.

## 5. Iterate with the LLM

When you spot gaps:

1. Copy the relevant section of `blueprint.toml`.
2. Explain what needs changing (e.g., “Add a dashboard page that groups tasks by status”).
3. Ask the LLM to rewrite only that section or provide a diff.
4. Merge the changes manually and let the runtime reload.

## Next Steps

- Add custom behaviors under `behaviors/` and wire them up in the blueprint.
- Explore the examples in `examples/` for more advanced patterns.
- Read the full [`docs/blueprint-specification.md`](blueprint-specification.md) to extend the schema confidently.

You're now ready to build and iterate on Zebric apps powered by AI-generated blueprints.
