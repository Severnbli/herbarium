<script lang="ts">
	import { resolve } from '$app/paths';
	import Dialog from '#lib/components/Dialog.svelte';
	import MemoryPreview from '#lib/components/MemoryPreview.svelte';
	import type { MemoryCard, MemoryGroup } from '#lib/domain/memory.ts';
	import type { Messages } from '#lib/i18n/catalog.ts';

	let {
		rows = [],
		groups,
		m
	}: {
		rows?: MemoryCard[];
		groups?: MemoryGroup[];
		m: Messages;
	} = $props();
	const gridId = $props.id();
	let open = $state(false);
	let selectedId = $state<string>();
	const cards = $derived(groups?.flatMap((group) => group.rows) ?? rows);
	const index = $derived(cards.findIndex((row) => row.id === selectedId));
	const selected = $derived(cards[index]);
	const title = $derived(selected ? selected.caption || mediaType(selected) : m.memory.title);

	function mediaType(row: MemoryCard) {
		return row.isVideo ? m.memory.video : m.memory.photo;
	}

	function show(event: MouseEvent, id: string) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		selectedId = id;
		open = true;
	}

	function step(direction: number) {
		const next = cards[index + direction];
		if (next) selectedId = next.id;
	}

	function navigate(event: KeyboardEvent) {
		if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLMediaElement)
			return;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			step(event.key === 'ArrowLeft' ? -1 : 1);
		}
	}
</script>

{#snippet thumbnails(items: MemoryCard[])}
	<ul class="memories">
		{#each items as row (row.id)}
			{@const label = row.caption}
			<li>
				<a
					class="memory"
					href={resolve('/memories/[id]', { id: row.id })}
					aria-label={label || row.altText || mediaType(row)}
					onclick={(event) => show(event, row.id)}
				>
					<img
						src={resolve('/media/[id]/[variant]', { id: row.id, variant: 'thumbnail' })}
						alt={row.altText}
						loading="lazy"
						decoding="async"
					/>
					{#if label}<span>{label}</span>{/if}
					{#if row.isVideo}<span class="label">{m.memory.video}</span>{/if}
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

{#if groups?.length}
	{#each groups as group (group.event?.id ?? null)}
		{@const heading = `${gridId}-${group.event?.id ?? 'unlinked'}`}
		<section class="group" aria-labelledby={heading}>
			<h2 id={heading}>
				{#if group.event}
					<a href={resolve('/events/[id]', { id: group.event.id })}>{group.event.title}</a>
				{:else}
					{m.memory.unlinked}
				{/if}
			</h2>
			{@render thumbnails(group.rows)}
		</section>
	{/each}
{:else if rows.length}
	{@render thumbnails(rows)}
{:else}
	<p>{m.memory.empty}</p>
{/if}

<Dialog bind:open {title} closeLabel={m.design.close} onkeydown={navigate} wide>
	{#if open && selected}
		{#key selected.id}
			<MemoryPreview memory={selected} {m} fallbackLabel={title} />
		{/key}
		<div class="controls">
			<button type="button" class="secondary" disabled={index === 0} onclick={() => step(-1)}
				>{m.memory.previous}</button
			>
			<a href={resolve('/memories/[id]', { id: selected.id })}>{m.memory.view}</a>
			<button
				type="button"
				class="secondary"
				disabled={index === cards.length - 1}
				onclick={() => step(1)}>{m.memory.next}</button
			>
		</div>
	{/if}
</Dialog>

<style>
	.group {
		margin-block: 1.5rem;
	}
	.group h2 {
		overflow-wrap: anywhere;
	}
	.memories {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(9rem, 100%), 1fr));
		gap: 0.65rem;
		list-style: none;
		padding: 0;
	}
	.memory {
		display: grid;
		gap: 0.35rem;
		padding: 0.25rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		overflow-wrap: anywhere;
	}
	.memory img {
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: var(--radius);
		background: var(--linen);
	}
	.label {
		font-size: 0.85rem;
		color: var(--muted);
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: space-between;
		align-items: center;
		margin-block: 1rem;
	}
</style>
