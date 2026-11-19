<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Field from '#lib/components/Field.svelte';
	import MapCanvas from '#lib/components/MapCanvas.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import { formatDateOnly } from '#lib/i18n/format.ts';
	import {
		checkReceipt,
		localFingerprint,
		mediaAccept,
		sendImportFile,
		type LocationSuggestion
	} from '#lib/media/import-client.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const uploadUrl = $derived(resolve('/memories/import/[id]/upload', { id: data.id }));

	type Job = {
		file: File;
		fingerprint?: string;
		status?: 'saved' | 'duplicate' | 'invalid' | 'size' | 'unsupported';
	};
	let queue = $state<Job[]>([]);
	let suggestions = $state<Record<string, LocationSuggestion>>({});
	let moments = $state<Record<string, boolean>>({});
	let preview = $state<string>();
	let active = $state<Job>();
	let fraction = $state(0);
	let paused = $state(false);
	let mounted = $state(false);
	let problem = $state<'busy' | 'unavailable' | 'closed' | 'full' | 'selection'>();
	let controller: AbortController | undefined;
	const complete = $derived(queue.filter((job) => job.status).length);

	onMount(() => {
		mounted = true;
		return () => controller?.abort();
	});

	function selectFiles(event: Event & { currentTarget: HTMLInputElement }) {
		const selected = Array.from(event.currentTarget.files ?? []);
		event.currentTarget.value = '';
		if (!selected.length) return;
		if (selected.length > data.maxFiles) {
			problem = 'selection';
			return;
		}
		queue = selected.map((file) => ({ file }));
		problem = undefined;
		paused = false;
	}

	async function upload() {
		if (active || complete === queue.length) return;
		controller = new AbortController();
		const { signal } = controller;
		paused = false;
		problem = undefined;
		try {
			for (const job of queue) {
				if (job.status) continue;
				signal.throwIfAborted();
				if (!job.file.size || job.file.size > data.maxFileBytes) {
					job.status = 'size';
					continue;
				}
				active = job;
				fraction = 0;
				job.fingerprint ??= await localFingerprint(job.file, signal);
				let response = await checkReceipt(uploadUrl, job.fingerprint, signal);
				if ('status' in response && response.status === 'ready') {
					response = await sendImportFile(uploadUrl, job.file, job.fingerprint, signal, (value) => {
						fraction = value;
					});
				}
				if ('problem' in response) {
					const issue = response.problem;
					if (issue === 'invalid' || issue === 'size' || issue === 'unsupported') {
						job.status = issue;
						continue;
					}
					problem = issue === 'missing' || issue === 'session' ? 'closed' : issue;
					break;
				}
				if (response.status === 'uploaded' && response.suggestion) {
					suggestions[response.id] = response.suggestion;
				}
				job.status = response.status === 'duplicate' ? 'duplicate' : 'saved';
			}
		} catch {
			paused = signal.aborted;
			if (!paused) problem = 'unavailable';
		} finally {
			fraction = 0;
			try {
				await invalidateAll();
			} finally {
				controller = undefined;
				active = undefined;
			}
		}
	}
</script>

<svelte:head><title>{m.mediaImport.title}</title></svelte:head>
<a href={resolve('/memories')}>{m.memory.back}</a>
<h1>{m.mediaImport.title}</h1>
<p>{m.mediaImport.uploadHelp}</p>
<noscript>
	<p><a href={resolve('/memories/new')}>{m.memory.upload}</a> · {m.mediaImport.javascript}</p>
</noscript>

<section class="upload" aria-label={m.mediaImport.title}>
	<div class="selectors">
		<label>
			{m.mediaImport.files}
			<input
				type="file"
				accept={mediaAccept}
				multiple
				disabled={!mounted || !!active}
				onchange={selectFiles}
			/>
		</label>
		<label>
			{m.mediaImport.folder}
			<input
				type="file"
				accept={mediaAccept}
				multiple
				webkitdirectory
				disabled={!mounted || !!active}
				onchange={selectFiles}
			/>
		</label>
	</div>
	{#if queue.length}
		<label class="progress">
			{m.mediaImport.progress(complete, queue.length)}
			<progress max={queue.length} value={complete + fraction}></progress>
		</label>
		<p role="status">
			{#if active}
				{fraction === 1 ? m.mediaImport.processing : m.mediaImport.uploading}
				{active.file.name}
			{:else if paused}
				{m.mediaImport.paused}
			{:else if complete === queue.length}
				{m.mediaImport.done}
			{/if}
		</p>
		<div class="controls">
			{#if active}
				<Button type="button" variant="secondary" onclick={() => controller?.abort()}
					>{m.mediaImport.pause}</Button
				>
			{:else if complete < queue.length}
				<Button type="button" onclick={upload}
					>{complete || paused || problem ? m.mediaImport.resume : m.memory.uploadSubmit}</Button
				>
			{/if}
		</div>
		<ul class="upload-results">
			{#each queue as job (job)}
				{#if job.status === 'duplicate'}
					<li>{job.file.name} · {m.mediaImport.duplicate}</li>
				{:else if job.status && job.status !== 'saved'}
					<li>
						{job.file.name} · {job.status === 'invalid' ? m.error.form : m.memory[job.status]}
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
	{#if problem}
		<p role="alert">
			{problem === 'busy'
				? m.memory.busy
				: problem === 'selection'
					? m.mediaImport.selection(data.maxFiles)
					: m.mediaImport[problem]}
		</p>
	{/if}
</section>

{#if data.groups.length || form?.created || form?.problem}
	<section aria-labelledby="organize-title">
		<h2 id="organize-title">{m.mediaImport.organize}</h2>
		<p>{m.mediaImport.organizeHelp}</p>
		{#if form?.problem}
			<p role="alert">{form.problem === 'invalid' ? m.error.form : m.mediaImport[form.problem]}</p>
		{/if}
		{#if form?.created}
			<p role="status">
				{#if form.created.eventId}
					<a href={resolve('/events/[id]', { id: form.created.eventId })}
						>{m.mediaImport.openMoment}</a
					>
				{/if}
				{#if form.created.albumId}
					<a href={resolve('/memories/albums/[id]', { id: form.created.albumId })}
						>{m.mediaImport.openAlbum}</a
					>
				{/if}
			</p>
		{/if}
		{#each data.groups as group (group.date)}
			{@const label = group.date ? formatDateOnly(data.locale, group.date) : m.mediaImport.undated}
			{@const photo = group.files.find((file) => suggestions[file.id])}
			{@const gps = photo && suggestions[photo.id]}
			<form method="POST" action="?/organize" use:enhance>
				<fieldset>
					<legend>{label}</legend>
					<ul>
						{#each group.files as file (file.id)}
							<li><a href={resolve('/memories/[id]', { id: file.id })}>{file.name}</a></li>
						{/each}
					</ul>
					<input type="hidden" name="date" value={group.date} />
					<input type="hidden" name="revision" value={group.revision} />
					<Field
						name="title"
						id={`group-title-${group.date || 'undated'}`}
						label={m.mediaImport.groupTitle}
						value={label}
						maxlength={120}
						required
					/>
					<label><input type="checkbox" name="album" /> {m.mediaImport.createAlbum}</label>
					{#if group.date}
						<label
							><input type="checkbox" name="moment" bind:checked={moments[group.date]} />
							{m.mediaImport.createMoment}</label
						>
					{/if}
					{#if gps && photo && moments[group.date]}
						<Button
							type="button"
							variant="secondary"
							aria-expanded={preview === group.date}
							onclick={() => {
								preview = preview === group.date ? undefined : group.date;
							}}
						>
							{m.memory.gpsTitle}
						</Button>
						{#if preview === group.date}
							<p>{photo.name} · {gps.lat}, {gps.lon}</p>
							<MapCanvas locale={data.locale} {m} basemap={data.basemap} position={gps} />
							<input type="hidden" name="gpsId" value={photo.id} />
							<input type="hidden" name="gpsToken" value={gps.token} />
							<label><input type="checkbox" name="acceptGps" /> {m.memory.gpsAccept}</label>
						{/if}
					{/if}
					<div><Button type="submit" disabled={!!active}>{m.mediaImport.confirmGroup}</Button></div>
				</fieldset>
			</form>
		{/each}
	</section>
{/if}
<form method="POST" action="?/finish">
	<Button type="submit" variant="secondary" disabled={!!active}>{m.mediaImport.finish}</Button>
</form>

<style>
	.upload,
	.selectors,
	fieldset,
	.progress {
		display: grid;
		gap: 0.75rem;
	}
	.upload,
	section,
	fieldset {
		margin-block: 1rem;
	}
	.selectors {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
	}
	.selectors label,
	.selectors input,
	.progress progress {
		display: block;
		width: 100%;
	}
	p,
	li {
		overflow-wrap: anywhere;
	}
	.upload-results:empty,
	[role='status']:empty {
		display: none;
	}
	[role='status'] a + a {
		margin-inline-start: 1rem;
	}
</style>
