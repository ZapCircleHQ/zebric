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
					items: [{ label: 'What is Zebric', slug: 'getting-started/what-is-zebric' }],
				},
				{
					label: 'Introduction',
					items: [{ label: 'Overview', slug: 'introduction/overview' }],
				},
				{
					label: 'Building',
					items: [{ label: 'Blueprint Fundamentals', slug: 'building/blueprint' }],
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
					items: [{ label: 'APIs & Commands', slug: 'reference/api' }],
				},
			],
		}),
	],
});
