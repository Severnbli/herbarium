<script lang="ts">
	let { kind = 'flower' }: { kind?: 'flower' | 'divider' | 'border' | 'frame' } = $props();
</script>

<svg
	class:wide={kind !== 'flower'}
	viewBox={kind === 'flower' ? '0 0 100 110' : '0 0 400 40'}
	aria-hidden="true"
	focusable="false"
>
	{#if kind === 'flower'}
		<g fill="none" stroke="currentColor" stroke-width="2">
			<path d="M50 105V40M50 84Q17 85 20 60Q45 59 50 84M50 69Q80 70 81 46Q56 45 50 69" />
			<path d="m50 8 7 16 17-6-6 17 16 7-16 7 6 17-17-6-7 16-7-16-17 6 6-17-16-7 16-7-6-17 17 6Z" />
			<circle cx="50" cy="42" r="8" />
		</g>
	{:else if kind === 'border'}
		<path fill="currentColor" d="M0 18h400v4H0z" />
		{#each [20, 60, 100, 140, 180, 220, 260, 300, 340, 380] as x (x)}
			<path
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				d="m{x} 5 15 15-15 15-15-15Z m0 8 7 7-7 7-7-7Z"
			/>
		{/each}
	{:else}
		<g fill="none" stroke="currentColor" stroke-width="2">
			<path
				d="M5 20h155m80 0h155m-195-14 14 14-14 14-14-14Z M170 20l-12-9m12 9-12 9m72-9 12-9m-12 9 12 9"
			/>
			{#if kind === 'frame'}<path d="M5 35V5h390v30" />{/if}
		</g>
	{/if}
</svg>

<style>
	svg {
		display: block;
		width: 5rem;
		height: 5.5rem;
		color: var(--moss);
		margin: 0 auto 1.5rem;
	}
	svg.wide {
		width: 100%;
		height: 2rem;
		color: var(--madder);
		margin-block: 1.5rem;
	}
</style>
