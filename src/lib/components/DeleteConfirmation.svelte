<script lang="ts">
	import Button from './Button.svelte';

	let {
		action = '?/delete',
		label,
		description,
		error
	}: { action?: string; label: string; description: string; error?: string } = $props();
</script>

<details open={!!error}>
	<summary>{label}</summary>
	<p>{description}</p>
	{#if error}<p role="alert">{error}</p>{/if}
	<form method="POST" {action}>
		<Button type="submit" name="confirm" value="delete" variant="secondary">{label}</Button>
	</form>
</details>

<style>
	details {
		margin-block: 1.5rem;
		padding-top: 0.8rem;
		border-block-start: 1px solid var(--line);
	}
	summary {
		width: fit-content;
		padding-block: 0.45rem;
		cursor: pointer;
		color: var(--madder);
	}
	p {
		margin-block: 0.5rem;
	}
</style>
