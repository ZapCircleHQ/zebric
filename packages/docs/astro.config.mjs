// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
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
					],
				},
				{
					label: 'Run',
					items: [{ label: 'Runtime & Deployment', slug: 'run/runtime' }],
				},
				{
					label: 'Guides',
					items: [{ label: 'Developer Onboarding', slug: 'guides/developer-onboarding' }],
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
