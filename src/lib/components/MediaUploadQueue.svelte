<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { Locale, Messages } from '#lib/i18n/index.ts';
	import { mediaAccept, sendMediaFile, type LocationSuggestion } from '#lib/media/import-client.ts';
	import Button from './Button.svelte';
	import MapCanvas from './MapCanvas.svelte';

	let {
		m,
		locale,
		basemap,
		endpoint,
		maxFileBytes,
		formatHint
	}: {
		m: Messages;
		locale: Locale;
		basemap: boolean;
		endpoint: string;
		maxFileBytes: number;
		formatHint: string;
	} = $props();

	type Job = {
		file: File;
		key: string;
		state: 'ready' | 'uploading' | 'uploaded' | 'failed';
		progress: number;
		problem?: string;
		suggestion?: LocationSuggestion & { id: string };
		locationProblem?: boolean;
	};
	const MAX_SELECTION = 100;
	let jobs = $state<Job[]>([]);
	let active = $state(false);
	let selectionTooLarge = $state(false);
	let locationSaved = $state(false);
	let current: AbortController | undefined;
	const ready = $derived(jobs.some((job) => job.state === 'ready'));
	const completed = $derived(jobs.filter((job) => job.state === 'uploaded').length);
	onDestroy(() => current?.abort());

	function selectFiles(input: HTMLInputElement) {
		const files = Array.from(input.files ?? []);
		input.value = '';
		selectionTooLarge = jobs.length + files.length > MAX_SELECTION;
		if (selectionTooLarge) return;
		jobs.push(
			...files.map((file): Job => ({
				file,
				key: crypto.randomUUID(),
				state: file.size > maxFileBytes ? 'failed' : 'ready',
				progress: 0,
				problem: file.size > maxFileBytes ? 'size' : undefined
			}))
		);
	}

	async function upload(only?: Job) {
		if (active) return;
		const controller = new AbortController();
		current = controller;
		active = true;
		try {
			for (const job of only ? [only] : jobs) {
				if ((!only && job.state !== 'ready') || controller.signal.aborted) continue;
				job.state = 'uploading';
				job.progress = 0;
				try {
					const result = await sendMediaFile(
						endpoint,
						job.file,
						job.key,
						controller.signal,
						(progress) => {
							job.progress = progress;
						}
					);
					if (
						!('problem' in result) &&
						(result.status === 'uploaded' || result.status === 'saved')
					) {
						job.state = 'uploaded';
						if (result.status === 'uploaded' && result.suggestion)
							job.suggestion = { ...result.suggestion, id: result.id };
					} else {
						job.state = 'failed';
						job.problem = 'problem' in result ? result.problem : 'interrupted';
					}
				} catch {
					job.state = 'failed';
					job.problem = 'interrupted';
				}
			}
		} finally {
			active = false;
		}
	}

	function problemText(problem?: string) {
		switch (problem) {
			case 'size':
			case 'unsupported':
			case 'busy':
			case 'unavailable':
				return m.memory[problem];
			case 'invalid':
				return m.error.form;
			default:
				return m.memory.interrupted;
		}
	}
</script>

<div class="picker">
	<label for="memory-files">{m.mediaImport.files}</label>
	<input
		id="memory-files"
		type="file"
		multiple
		accept={mediaAccept}
		disabled={active}
		aria-describedby="memory-formats"
		onchange={(event) => selectFiles(event.currentTarget)}
	/>
	<p id="memory-formats">{formatHint}</p>
	{#if selectionTooLarge}<p role="alert">{m.mediaImport.selection(MAX_SELECTION)}</p>{/if}
</div>

{#if jobs.length}
	<div class="summary">
		<p role="status">{m.memory.uploadProgress(completed, jobs.length)}</p>
		<Button type="button" disabled={active || !ready} onclick={() => void upload()}>
			{m.memory.uploadSubmit}
		</Button>
	</div>
	<ul class="queue">
		{#each jobs as job (job.key)}
			<li>
				<div class="job">
					<strong>{job.file.name}</strong>
					{#if job.state === 'uploading'}
						{#if job.progress < 1}
							<progress max={1} value={job.progress} aria-label={m.mediaImport.uploading}
							></progress>
						{:else}
							<span>{m.mediaImport.processing}</span>
						{/if}
					{:else if job.state === 'uploaded'}
						<span class="uploaded">{m.memory.uploaded}</span>
					{:else if job.state === 'failed'}
						<div>
							<p role="alert">{problemText(job.problem)}</p>
							{#if job.problem !== 'size'}
								<Button
									type="button"
									variant="secondary"
									disabled={active}
									onclick={() => void upload(job)}>{m.memory.retry}</Button
								>
							{/if}
						</div>
					{:else}
						<span>{m.memory.ready}</span>
					{/if}
				</div>
				{#if job.suggestion && !active && !locationSaved}
					{@const suggestion = job.suggestion}
					<details>
						<summary>{m.memory.gpsTitle}</summary>
						<p>{m.memory.gpsHint}</p>
						<p>
							{new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(suggestion.lat)},
							{new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(suggestion.lon)}
						</p>
						{#if basemap}
							<MapCanvas {locale} {m} {basemap} position={suggestion} />
						{/if}
						<!-- The action suffix targets the resolved memory page. -->
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<form
							method="POST"
							action={resolve('/memories/[id]', { id: suggestion.id }) + '?/coordinates'}
							use:enhance={({ cancel }) => {
								if (locationSaved) {
									cancel();
									return;
								}
								return ({ result }) => {
									if (result.type === 'redirect') locationSaved = true;
									else job.locationProblem = true;
								};
							}}
						>
							<input type="hidden" name="token" value={suggestion.token} />
							<Button type="submit" variant="secondary">{m.memory.gpsAccept}</Button>
						</form>
						{#if job.locationProblem}<p role="alert">{m.memory.coordinates}</p>{/if}
					</details>
				{/if}
			</li>
		{/each}
	</ul>
	{#if locationSaved}<p role="status">{m.memory.gpsSaved}</p>{/if}
{/if}

<style>
	.picker {
		display: grid;
		gap: 0.5rem;
	}
	.picker p,
	.summary p,
	.job p {
		margin: 0;
	}
	.picker input {
		max-width: 100%;
	}
	#memory-formats {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.summary,
	.job {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.55rem 1rem;
	}
	.summary {
		margin-top: 1.25rem;
	}
	.queue {
		list-style: none;
		padding: 0;
	}
	.queue li {
		border-top: 1px solid var(--line);
		padding-block: 0.7rem;
		overflow-wrap: anywhere;
	}
	.job progress {
		max-width: 100%;
	}
	.uploaded {
		color: var(--moss);
	}
	details {
		margin-block: 0.5rem;
	}
</style>
