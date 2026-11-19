<script lang="ts">
	import { resolve } from '$app/paths';
	import Dialog from '#lib/components/Dialog.svelte';
	import MemoryPreview from '#lib/components/MemoryPreview.svelte';
	import type { MemoryCard } from '#lib/domain/memory.ts';
	import type { Messages } from '#lib/i18n/catalog.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	import { formatDateOnly } from '#lib/i18n/format.ts';

	let { rows, locale, m }: { rows: MemoryCard[]; locale: Locale; m: Messages } = $props();
	let open = $state(false);
	let index = $state(0);
	const selected = $derived(rows[index]);

	function show(event: MouseEvent, position: number) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		index = position;
		open = true;
	}

	function step(direction: number) {
		index = Math.max(0, Math.min(rows.length - 1, index + direction));
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

{#if rows.length}
	<ul class="memories">
		{#each rows as row, position (row.id)}
			<li>
				<a
					class="memory"
					href={resolve('/memories/[id]', { id: row.id })}
					onclick={(event) => show(event, position)}
				>
					<img
						src={resolve('/media/[id]/[variant]', { id: row.id, variant: 'thumbnail' })}
						alt={row.altText}
						loading="lazy"
						decoding="async"
					/>
					<span>{row.caption || row.originalName}</span>
					<span class="label">
						{#if row.isVideo}{m.memory.video} ·
						{/if}<time datetime={row.sortDate}>{formatDateOnly(locale, row.sortDate)}</time>
					</span>
				</a>
			</li>
		{/each}
	</ul>
{:else}
	<p>{m.memory.empty}</p>
{/if}

<Dialog
	bind:open
	title={selected?.caption || selected?.originalName || m.memory.title}
	closeLabel={m.design.close}
	onkeydown={navigate}
	wide
>
	{#if open && selected}
		{#key selected.id}<MemoryPreview memory={selected} {m} />{/key}
		<div class="controls">
			<button type="button" class="secondary" disabled={index === 0} onclick={() => step(-1)}
				>{m.memory.previous}</button
			>
			<a href={resolve('/memories/[id]', { id: selected.id })}>{m.memory.view}</a>
			<button
				type="button"
				class="secondary"
				disabled={index === rows.length - 1}
				onclick={() => step(1)}>{m.memory.next}</button
			>
		</div>
	{/if}
</Dialog>

<style>
	.memories {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(9rem, 100%), 1fr));
		gap: 1rem;
		list-style: none;
		padding: 0;
	}
	.memory {
		display: grid;
		gap: 0.35rem;
		padding: 0.5rem;
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
