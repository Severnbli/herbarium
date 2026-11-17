<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	let {
		children,
		variant = 'primary',
		...attributes
	}: HTMLButtonAttributes & { children: Snippet; variant?: 'primary' | 'secondary' } = $props();
</script>

<button class:secondary={variant === 'secondary'} {...attributes}>{@render children()}</button>
