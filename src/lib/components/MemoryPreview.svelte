<script lang="ts">
	import { resolve } from '$app/paths';
	import type { MemoryCard } from '#lib/domain/memory.ts';
	import type { Messages } from '#lib/i18n/catalog.ts';

	let { memory, m, fallbackLabel }: { memory: MemoryCard; m: Messages; fallbackLabel?: string } =
		$props();
	const label = $derived(memory.altText || (fallbackLabel ?? memory.originalName));
	const preview = $derived(resolve('/media/[id]/[variant]', { id: memory.id, variant: 'preview' }));
</script>

{#if memory.isVideo}
	<!-- The member's description identifies this uploaded video. -->
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		controls
		playsinline
		preload="metadata"
		aria-label={label}
		poster={resolve('/media/[id]/[variant]', { id: memory.id, variant: 'thumbnail' })}
		src={preview}
	>
		<a href={resolve('/media/[id]/[variant]', { id: memory.id, variant: 'original' })}
			>{m.memory.download}</a
		>
	</video>
{:else}
	<img src={preview} alt={label} />
{/if}

<style>
	img,
	video {
		display: block;
		width: 100%;
		max-height: 66dvh;
		object-fit: contain;
		background: var(--linen);
		border-radius: var(--radius);
	}
</style>
