<script lang="ts">
	import { onMount } from 'svelte';
	import type { Messages } from '#lib/i18n/catalog.ts';
	let { m }: { m: Messages } = $props();
	let theme = $state('system');
	onMount(() => {
		try {
			theme = localStorage.getItem('herbarium-theme') ?? 'system';
		} catch {
			/* Storage may be disabled. */
		}
		apply();
	});
	function apply() {
		if (theme !== 'light' && theme !== 'dark') theme = 'system';
		if (theme === 'system') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = theme;
	}
	function save() {
		apply();
		try {
			localStorage.setItem('herbarium-theme', theme);
		} catch {
			/* The current page still changes. */
		}
	}
</script>

<div class="theme-picker">
	<label for="theme">{m.design.theme}</label>
	<select id="theme" bind:value={theme} onchange={save}>
		<option value="system">{m.design.system}</option>
		<option value="light">{m.design.light}</option>
		<option value="dark">{m.design.dark}</option>
	</select>
</div>

<style>
	.theme-picker {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	label {
		font-size: 0.85rem;
	}
</style>
