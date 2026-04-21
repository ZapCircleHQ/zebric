// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.zebric.dev',
	integrations: [
		starlight({
			title: 'Zebric Docs',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ZapCircleHQ/zebric' }],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'What is Zebric', slug: 'getting-started/what-is-zebric' },
						{ label: 'Quickstart', slug: 'getting-started/quickstart' },
					],
				},
				{
					label: 'Introduction',
					items: [{ label: 'Overview', slug: 'introduction/overview' }],
				},
				{
					label: 'Building',
					items: [
						{ label: 'Blueprint Reference', slug: 'building/blueprint' },
						{ label: 'Workflows & Notifications', slug: 'building/workflows' },
						{ label: 'Security & Auth', slug: 'building/security' },
						{ label: 'File Uploads', slug: 'building/file-uploads' },
					],
				},
				{
					label: 'Run',
					items: [
						{ label: 'Runtime & Deployment', slug: 'run/runtime' },
						{ label: 'Dev Server & Debugging', slug: 'run/dev-server' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Developer Onboarding', slug: 'guides/developer-onboarding' },
						{ label: 'Troubleshooting', slug: 'guides/troubleshooting' },
						{ label: 'Migrate to Zebric', slug: 'guides/migrate-to-zebric' },
					],
				},
				{
					label: 'Courses',
					items: [
						{
							label: 'Build Internal Tools Without Distracting Engineering',
							items: [
								{
									label: 'Overview',
									slug: 'courses/tutorial-ops',
								},
								{
									label: 'Lesson 1 - Define the Workflow',
									slug: 'courses/tutorial-ops/lesson-1-define-the-workflow',
								},
								{
									label: 'Lesson 2 - Generate the First Blueprint With AI',
									slug: 'courses/tutorial-ops/lesson-2-generate-the-first-blueprint-with-ai',
								},
								{
									label: 'Lesson 3 - Shape the Data Model',
									slug: 'courses/tutorial-ops/lesson-3-shape-the-data-model',
								},
								{
									label: 'Lesson 4 - Improve Intake and Review Pages',
									slug: 'courses/tutorial-ops/lesson-4-improve-intake-and-review-pages',
								},
								{
									label: 'Lesson 5 - Add Permissions and Guardrails',
									slug: 'courses/tutorial-ops/lesson-5-add-permissions-and-guardrails',
								},
								{
									label: 'Lesson 6 - Add Your First High-Leverage Workflow',
									slug: 'courses/tutorial-ops/lesson-6-add-your-first-high-leverage-workflow',
								},
								{
									label: 'Lesson 7 - Polish With Real Feedback',
									slug: 'courses/tutorial-ops/lesson-7-polish-with-real-feedback',
								},
								{
									label: 'Lesson 8 - Deploy and Roll Out the Tool',
									slug: 'courses/tutorial-ops/lesson-8-deploy-and-roll-out-the-tool',
								},
							],
						},
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'CLI', slug: 'reference/cli' },
						{ label: 'REST API & OpenAPI', slug: 'reference/api' },
						{ label: 'Skills', slug: 'reference/skills' },
					],
				},
			],
		}),
	],
});
