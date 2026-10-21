// Starlight 0.42 no longer ships types for its internal `virtual:starlight/user-config`
// module, but its own Header still imports it at runtime. ZebricHeader mirrors that
// logic, so declare only the fields it reads.
declare module 'virtual:starlight/user-config' {
	const config: {
		pagefind: boolean;
		components: Record<string, string>;
	};
	export default config;
}
