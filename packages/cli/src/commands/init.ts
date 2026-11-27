import { lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

/** Create a runnable first app without installing packages or overwriting user files. */
export async function createProject(directory = '.'): Promise<string> {
  const target = resolve(directory)
  const template = await readFile(new URL('../../templates/blueprint.toml', import.meta.url), 'utf8')
  const cliPackage = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  let existing
  try { existing = await lstat(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (existing && (!existing.isDirectory() || (await readdir(target)).length > 0)) {
    throw new Error(`Refusing to overwrite ${target}. Choose a new or empty directory.`)
  }
  await mkdir(target, { recursive: true })
  const name = basename(target).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 214) || 'zebric-app'
  const files: Record<string, string> = {
    'blueprint.toml': template,
    'package.json': `${JSON.stringify({
      name, version: '1.0.0', private: true,
      scripts: { dev: 'zebric dev --seed', validate: 'zebric validate', audit: 'zebric audit' },
      engines: { node: '>=22.0.0' },
      dependencies: { '@zebric/cli': cliPackage.version },
    }, null, 2)}\n`,
    '.gitignore': 'node_modules/\ndata/\n.env\n.env.*\n!.env.example\n',
    'README.md': `# Your Zebric app

\`\`\`bash
npm install
npm run validate
npm run dev
\`\`\`

Open http://localhost:3000 for three sample posts. Visit /posts/new, select
Sign up, and create an account. Return to /posts/new to create your first post.

Edit title = "All Posts" in blueprint.toml, save, and watch the browser reload.
Records persist in data/app.db. Stop with Ctrl+C; restarting skips existing seed data.

This learning app allows public reads and lets any signed-in user modify any post.
All posts are public, including unpublished ones. Add ownership rules and publication
filters before adapting it for multiple authors or private drafts.

Continue at https://docs.zebric.dev/getting-started/quickstart/ and
https://docs.zebric.dev/building/security/.
`,
  }
  const created: string[] = []
  try {
    for (const [name, contents] of Object.entries(files)) {
      const path = join(target, name)
      await writeFile(path, contents, { flag: 'wx' })
      created.push(path)
    }
  } catch (error) {
    // Remove only files this invocation created; never delete a competing writer's file.
    await Promise.allSettled(created.map(path => unlink(path)))
    throw error
  }
  return target
}

export async function initCommand(directory = '.'): Promise<void> {
  try {
    const target = await createProject(directory)
    console.log(`Created a Zebric app in ${target}\n\nNext steps:`)
    if (target !== process.cwd()) console.log(`  cd '${target.replaceAll("'", "'\"'\"'")}'`)
    console.log('  npm install\n  npm run validate\n  npm run dev\n\nOpen http://localhost:3000, then visit /posts/new to sign up and create a post.')
  } catch (error) {
    console.error(`Could not create app: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
