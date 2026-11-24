<script lang="ts">
	import { onMount } from 'svelte';
	import type { Coordinates } from '#lib/domain/location.ts';
	import type { Locale, Messages } from '#lib/i18n/index.ts';
	import type { MapController } from '#lib/maps/client.ts';
	import type { MapEntry } from '#lib/maps/entry.ts';

	let {
		locale,
		m,
		basemap,
		position = null,
		entries,
		onPick
	}: {
		locale: Locale;
		m: Messages;
		basemap: boolean;
		position?: Coordinates | null;
		entries?: MapEntry[];
		onPick?: (point: Coordinates) => void;
	} = $props();

	let container: HTMLDivElement;
	let controller = $state.raw<MapController>();
	let failed = $state(false);
	let mounted = $state(false);

	onMount(() => {
		mounted = true;
		let disposed = false;
		void import('#lib/maps/client.ts')
			.then(({ createMap }) => {
				if (disposed) return;
				controller = createMap({
					container,
					locale,
					m: m.map,
					basemap,
					position,
					entries,
					onPick,
					onError: () => (failed = true)
				});
			})
			.catch(() => {
				if (!disposed) failed = true;
			});

		return () => {
			disposed = true;
			controller?.remove();
		};
	});

	$effect(() => controller?.setPosition(position));
	$effect(() => {
		if (entries) controller?.setEntries(entries);
	});
</script>

<figure class:overview={entries !== undefined}>
	<div class="canvas" hidden={!mounted || (failed && !controller)} bind:this={container}></div>
	{#if failed}
		<p role="status">{m.map.unavailable}</p>
	{/if}
	{#if !basemap}
		<p class="hint">{m.map.noBasemap}</p>
	{:else}
		<figcaption class="attribution">
			<a href="https://www.openstreetmap.org/copyright" rel="noreferrer">{m.map.osm}</a>
			<span aria-hidden="true"> · </span>
			<a href="https://protomaps.com/" rel="noreferrer">Protomaps</a>
		</figcaption>
	{/if}
</figure>

<style>
	figure {
		margin: 0;
		min-width: 0;
	}
	.canvas {
		min-height: 19rem;
		height: clamp(19rem, 52vh, 31rem);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--linen);
	}
	.overview .canvas {
		height: clamp(23rem, 63vh, 42rem);
	}
	figure p {
		margin-block: 0.35rem;
	}
	.attribution {
		font-size: 0.8rem;
		text-align: end;
	}
	.canvas :global(.maplibregl-ctrl-group) {
		background: var(--paper);
	}
	:global(:root[data-theme='dark']) .canvas :global(.maplibregl-ctrl-icon) {
		filter: invert(1);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .canvas :global(.maplibregl-ctrl-icon) {
			filter: invert(1);
		}
	}
	.canvas :global(.maplibregl-ctrl-group button) {
		min-width: 2.75rem;
		min-height: 2.75rem;
		border-color: var(--line);
	}
	.canvas :global(.maplibregl-popup-content) {
		color: var(--ink);
		background: var(--paper);
		padding: 0.85rem 2.65rem 0.85rem 1rem;
	}
	.canvas :global(.maplibregl-popup-close-button) {
		color: var(--ink);
		padding: 0.3rem;
		min-width: 2.75rem;
	}
	.canvas :global(.event-map-group) {
		max-height: 13rem;
		overflow: auto;
		overflow-wrap: anywhere;
	}
	.canvas :global(.event-map-popup + .event-map-popup) {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--line);
	}
	.canvas :global(.event-map-popup p) {
		margin: 0.25rem 0;
		font-size: 0.875rem;
	}
	.canvas :global(.event-map-popup a) {
		font-weight: bold;
	}
	.canvas :global(.event-map-popup img) {
		display: block;
		max-width: 100%;
		max-height: 9rem;
		object-fit: contain;
		border-radius: var(--radius);
	}
</style>
