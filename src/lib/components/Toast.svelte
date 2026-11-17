<script lang="ts">
	let { message, closeLabel }: { message: string; closeLabel: string } = $props();
	let dismissed = $state(false);
</script>

<div role="status" aria-live="polite">
	{#if !dismissed}
		<p>{message}</p>
		<button
			type="button"
			class="secondary"
			onclick={() => {
				dismissed = true;
			}}>{closeLabel}</button
		>
	{/if}
</div>

<style>
	div {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
	}
	p {
		border-inline-start: 3px solid var(--moss);
		padding-inline-start: 1rem;
	}
</style>
