<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount, untrack } from 'svelte';
	import Field from './Field.svelte';
	import MapCanvas from './MapCanvas.svelte';
	import {
		coordinatePair,
		readCoordinates,
		type Coordinates,
		type GazetteerPlace
	} from '#lib/domain/location.ts';
	import type { Locale, Messages } from '#lib/i18n/index.ts';

	let {
		m,
		locale,
		basemap,
		initial,
		latError,
		lonError,
		placeError,
		savedPlaces = [],
		extra = false,
		required = false,
		eventId
	}: {
		m: Messages;
		locale: Locale;
		basemap: boolean;
		initial: { lat: string; lon: string; place: string };
		latError?: string;
		lonError?: string;
		placeError?: string;
		savedPlaces?: { id: string; place: string; lat: number; lon: number }[];
		extra?: boolean;
		required?: boolean;
		eventId?: string;
	} = $props();

	const uid = $props.id();
	let { lat, lon, place } = $state(
		untrack(() => ({ lat: initial.lat, lon: initial.lon, place: initial.place }))
	);
	let expanded = $state(
		untrack(() => !!(required || latError || lonError || initial.lat || initial.lon))
	);
	let mounted = $state(false);
	let paste = $state('');
	let pasteError = $state(false);
	let searchText = $state('');
	let searching = $state(false);
	let searchError = $state(false);
	let results = $state<GazetteerPlace[] | null>(null);
	let request: AbortController | undefined;
	const position = $derived(readCoordinates(lat, lon));
	const countries = $derived(new Intl.DisplayNames([locale], { type: 'region' }));

	onMount(() => {
		mounted = true;
		return () => request?.abort();
	});

	function setPoint(point: Coordinates | null) {
		lat = point ? String(point.lat) : '';
		lon = point ? String(point.lon) : '';
		pasteError = false;
	}

	function usePair() {
		const point = coordinatePair(paste);
		if (!point) {
			pasteError = true;
			return;
		}
		setPoint(point);
		paste = '';
	}

	async function search() {
		const query = searchText.trim();
		if (query.length < 2) return;
		request?.abort();
		const current = new AbortController();
		request = current;
		searchError = false;
		searching = true;
		results = null;
		try {
			const response = await fetch(resolve('/map/search'), {
				method: 'POST',
				body: new URLSearchParams({ q: query }),
				signal: current.signal
			});
			if (!response.ok) throw new Error('Search unavailable');
			const found: GazetteerPlace[] = await response.json();
			if (!current.signal.aborted) results = found;
		} catch {
			if (!current.signal.aborted) searchError = true;
		} finally {
			if (!current.signal.aborted) searching = false;
		}
	}

	function onEnter(key: KeyboardEvent, action: () => void) {
		if (key.key !== 'Enter' || key.isComposing) return;
		key.preventDefault();
		action();
	}
</script>

{#if mounted && savedPlaces.length}
	<label for={uid + '-saved'}>{m.map.useSaved}</label>
	<select
		id={uid + '-saved'}
		onchange={(e) => {
			const chosen = savedPlaces.find((p) => p.id === e.currentTarget.value);
			if (chosen) {
				setPoint(chosen);
				place = chosen.place;
			}
			e.currentTarget.value = '';
		}}
	>
		<option value="">{m.map.useSaved}</option>
		{#each savedPlaces as saved (saved.id)}<option value={saved.id}>{saved.place}</option>{/each}
	</select>
{/if}
<Field
	id={uid + '-place'}
	{required}
	name={extra ? 'extra-place' : 'place'}
	label={m.event.place}
	value={place}
	oninput={(event) => (place = event.currentTarget.value)}
	error={placeError}
	maxlength={200}
/>
<details bind:open={expanded}>
	<summary>{m.map.picker}</summary>
	{#if mounted && expanded}
		<div class="tools">
			<div class="input-action">
				<label for={uid + '-place-search'}>{m.map.searchLabel}</label>
				<input
					id={uid + '-place-search'}
					type="search"
					bind:value={searchText}
					maxlength={100}
					onkeydown={(event) => onEnter(event, search)}
					autocomplete="off"
				/>
				<button
					type="button"
					class="secondary"
					disabled={searching || searchText.trim().length < 2}
					onclick={search}
				>
					{m.map.search}
				</button>
			</div>
			<p class="credit">
				<a href="https://www.geonames.org/" rel="noreferrer">GeoNames</a>
				<span aria-hidden="true"> · </span>
				<a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">CC BY 4.0</a>
			</p>
			{#if searching}
				<p role="status">{m.map.searching}</p>
			{:else if searchError}
				<p role="status">{m.map.searchError}</p>
			{:else if results?.length === 0}
				<p role="status">{m.map.noResults}</p>
			{:else if results}
				<ul class="results" aria-label={m.map.results}>
					{#each results as result (result.id)}
						<li>
							<button
								type="button"
								class="secondary"
								onclick={() => {
									setPoint(result);
									place = result.name;
									results = null;
									document.getElementById(uid + '-place')?.focus();
								}}
							>
								{result.name} <small>{countries.of(result.country) ?? result.country}</small>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="input-action">
				<label for={uid + '-paste-coordinates'}>{m.map.paste}</label>
				<input
					id={uid + '-paste-coordinates'}
					bind:value={paste}
					placeholder="53.9023, 27.5619"
					maxlength={70}
					aria-invalid={pasteError}
					aria-describedby={pasteError ? uid + '-paste-error' : undefined}
					onkeydown={(event) => onEnter(event, usePair)}
				/>
				<button type="button" class="secondary" onclick={usePair}>{m.map.usePin}</button>
			</div>
			{#if pasteError}<p role="status" id={uid + '-paste-error'}>{m.map.badPair}</p>{/if}
			<p class="hint">{m.map.pickHint}</p>
			<MapCanvas {locale} {m} {basemap} {position} onPick={setPoint} />
		</div>
	{/if}
	<p class="hint">{m.event.coordinatesHint}</p>
	<div class="coordinate-fields">
		<Field
			id={uid + '-lat'}
			{required}
			name={extra ? 'extra-lat' : 'lat'}
			label={m.event.lat}
			value={lat}
			oninput={(event) => (lat = event.currentTarget.value)}
			inputmode="decimal"
			error={latError}
			maxlength={32}
		/>
		<Field
			id={uid + '-lon'}
			{required}
			name={extra ? 'extra-lon' : 'lon'}
			label={m.event.lon}
			value={lon}
			oninput={(event) => (lon = event.currentTarget.value)}
			inputmode="decimal"
			error={lonError}
			maxlength={32}
		/>
	</div>
	<div class="location-actions">
		{#if mounted}
			<button
				type="button"
				class="secondary"
				disabled={!lat && !lon}
				onclick={() => setPoint(null)}
			>
				{m.map.clear}
			</button>
		{/if}
		{#if eventId && !position}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={`${resolve('/memories/new')}?event=${eventId}`}>{m.map.photoLocation}</a>
		{/if}
	</div>
</details>

<style>
	details {
		margin-block: 1rem;
	}
	summary {
		cursor: pointer;
		color: var(--muted);
	}
	.tools {
		margin-block: 1rem 0;
	}
	.input-action {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.75rem;
	}
	.input-action label {
		grid-column: 1 / -1;
	}
	.credit {
		margin-top: 0.25rem;
		font-size: 0.8rem;
	}
	.results {
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.35rem;
	}
	.results button {
		width: 100%;
		justify-content: space-between;
		text-align: start;
	}
	.results small {
		color: var(--muted);
	}
	.coordinate-fields,
	.location-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 1rem;
	}
	.coordinate-fields :global(.field) {
		flex: 1 1 8rem;
	}
</style>
