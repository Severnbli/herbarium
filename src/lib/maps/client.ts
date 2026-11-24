import { resolve } from '$app/paths';
import {
	addProtocol,
	LngLatBounds,
	Map as MapLibreMap,
	Marker,
	NavigationControl,
	Popup,
	setWorkerUrl,
	type GeoJSONSource,
	type MapMouseEvent,
	type StyleSpecification
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import type { FeatureCollection, Point } from 'geojson';
import type { Coordinates } from '#lib/domain/location.ts';
import type { Locale, Messages } from '#lib/i18n/index.ts';
import type { MapEntry } from './entry.ts';
import { mapFont, mapStyle, palette } from './style.ts';

const sourceId = 'events';
const clusterLayer = 'event-clusters';
const markerLayer = 'event-markers';
const defaultCenter: [number, number] = [27.56, 53.9];
const mercatorLimit = 85.051129;
const coordinate = ({ lat, lon }: Coordinates): [number, number] => [
	lon,
	Math.max(-mercatorLimit, Math.min(mercatorLimit, lat))
];

let protocolRegistered = false;
export type MapController = ReturnType<typeof createMap>;
type Camera = { center: [number, number]; zoom: number };

function groupEntries(entries: MapEntry[]) {
	const groups = new Map<string, Map<string, MapEntry>>();
	for (const entry of entries) {
		const key = coordinate(entry).join(',');
		let events = groups.get(key);
		if (!events) {
			events = new Map();
			groups.set(key, events);
		}
		events.set(entry.id, entry);
	}
	return new Map(Array.from(groups, ([key, events]) => [key, [...events.values()]]));
}

function geojson(groups: ReturnType<typeof groupEntries>): FeatureCollection<Point> {
	return {
		type: 'FeatureCollection',
		features: Array.from(groups, ([key, events]) => ({
			type: 'Feature',
			properties: { key, kind: events[0]!.kind, count: events.length },
			geometry: { type: 'Point', coordinates: coordinate(events[0]!) }
		}))
	};
}

function eventLayers(
	style: StyleSpecification,
	groups: ReturnType<typeof groupEntries>,
	dark: boolean
) {
	const colors = palette[dark ? 'dark' : 'light'];
	style.sources[sourceId] = {
		type: 'geojson',
		data: geojson(groups),
		cluster: true,
		clusterRadius: 44,
		clusterMaxZoom: 15
	};
	style.layers.push(
		{
			id: clusterLayer,
			type: 'circle',
			source: sourceId,
			filter: ['has', 'point_count'],
			paint: {
				'circle-color': colors.cluster,
				'circle-radius': 19,
				'circle-stroke-color': colors.halo,
				'circle-stroke-width': 2
			}
		},
		{
			id: 'event-counts',
			type: 'symbol',
			source: sourceId,
			filter: ['has', 'point_count'],
			layout: {
				'text-field': ['get', 'point_count_abbreviated'],
				'text-font': mapFont,
				'text-size': 13,
				'text-allow-overlap': true
			},
			paint: { 'text-color': colors.clusterText }
		},
		{
			id: markerLayer,
			type: 'symbol',
			source: sourceId,
			filter: ['!', ['has', 'point_count']],
			layout: {
				'icon-image': ['concat', 'events:', ['get', 'kind']],
				'icon-anchor': 'bottom',
				'icon-allow-overlap': true,
				'text-field': ['case', ['>', ['get', 'count'], 1], ['to-string', ['get', 'count']], ''],
				'text-font': mapFont,
				'text-size': 13,
				'text-offset': [0, -3],
				'text-allow-overlap': true
			},
			paint: {
				'text-color': colors.cluster,
				'text-halo-color': colors.halo,
				'text-halo-width': 2
			}
		}
	);
	return style;
}

function popupContent(entry: MapEntry) {
	const panel = document.createElement('div');
	panel.className = 'event-map-popup';
	const title = document.createElement('a');
	title.textContent = entry.title;
	title.href = resolve('/events/[id]', { id: entry.id });
	const date = document.createElement('p');
	date.textContent = entry.date;
	panel.append(title);
	if (entry.date) panel.append(date);
	if (entry.place) {
		const name = document.createElement('p');
		name.textContent = entry.place;
		panel.append(name);
	}
	if (entry.preview) {
		const image = document.createElement('img');
		image.alt = entry.preview.label;
		image.src = resolve('/media/[id]/[variant]', { id: entry.preview.id, variant: 'thumbnail' });
		panel.append(image);
	}
	return panel;
}

export function createMap({
	container,
	locale,
	m,
	basemap,
	position,
	camera,
	entries,
	onPick,
	onError
}: {
	container: HTMLElement;
	locale: Locale;
	m: Messages['map'];
	basemap: boolean;
	position: Coordinates | null;
	camera?: Camera;
	entries?: MapEntry[];
	onPick?: (point: Coordinates) => void;
	onError: () => void;
}) {
	const assetPath = resolve('/map/assets/[...asset]', { asset: 'basemap.pmtiles' });
	const archive = new URL(assetPath, location.origin).href;
	const assets = archive.slice(0, archive.lastIndexOf('/'));
	if (!protocolRegistered) {
		const protocol = new Protocol();
		addProtocol('pmtiles', protocol.tile);
		protocolRegistered = true;
	}
	// Use a bundled same-origin module worker so the document can keep worker-src 'self'.
	setWorkerUrl(workerUrl);
	const root = document.documentElement;
	const systemTheme = matchMedia('(prefers-color-scheme: dark)');
	const isDark = () =>
		root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && systemTheme.matches);
	let dark = isDark();
	let groups = groupEntries(entries ?? []);
	const style = () => {
		const base = mapStyle(assets, locale, basemap, dark);
		return entries ? eventLayers(base, groups, dark) : base;
	};
	const map = new MapLibreMap({
		container,
		style: style(),
		attributionControl: false,
		center: camera?.center ?? (position ? coordinate(position) : defaultCenter),
		zoom: camera?.zoom ?? (position ? 12 : 5.5),
		maxZoom: 19,
		renderWorldCopies: false,
		cooperativeGestures: true,
		dragRotate: false,
		pitchWithRotate: false,
		touchPitch: false,
		fadeDuration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200,
		locale: {
			'Map.Title': m.canvas,
			'Marker.Title': m.pin,
			'NavigationControl.ZoomIn': m.zoomIn,
			'NavigationControl.ZoomOut': m.zoomOut,
			'CooperativeGesturesHandler.WindowsHelpText': m.ctrlZoom,
			'CooperativeGesturesHandler.MacHelpText': m.cmdZoom,
			'CooperativeGesturesHandler.MobileHelpText': m.touchPan,
			'Popup.Close': m.close
		},
		transformRequest: (url) => {
			if (url === `pmtiles://${archive}` || url.startsWith(`pmtiles://${archive}/`)) return { url };
			if (new URL(url, location.origin).origin !== location.origin)
				throw new Error('Invalid map resource');
			return { url, credentials: 'same-origin' };
		}
	});
	map.on('error', onError);
	map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
	map.touchZoomRotate.disableRotation();

	let marker: Marker | undefined;
	let popup: Popup | undefined;
	const publish = ({ lng, lat }: { lng: number; lat: number }) =>
		onPick?.({
			lat: Number(Math.max(-90, Math.min(90, lat)).toFixed(6)),
			lon: Number(lng.toFixed(6))
		});

	function setPosition(next: Coordinates | null, recenter = true) {
		if (!next) {
			marker?.remove();
			marker = undefined;
		} else if (!position || next.lat !== position.lat || next.lon !== position.lon || !marker) {
			const point = coordinate(next);
			const previous = marker?.getLngLat();
			if (!marker) {
				marker = new Marker({ draggable: !!onPick, color: palette[dark ? 'dark' : 'light'].pin });
				marker.setLngLat(point).addTo(map);
				marker.on('dragend', () => {
					if (marker) publish(marker.getLngLat().wrap());
				});
			} else {
				marker.setLngLat(point);
			}
			if (recenter && (!previous || !map.getBounds().contains(point)))
				map.jumpTo({ center: point, zoom: 12 });
		}
		position = next;
	}
	setPosition(position, !camera);

	function fitEntries() {
		if (!entries?.length) return;
		const bounds = new LngLatBounds();
		for (const entry of entries) bounds.extend(coordinate(entry));
		map.fitBounds(bounds, { padding: 48, maxZoom: 12, animate: false });
	}

	function setEntries(next: MapEntry[]) {
		if (entries === next) return;
		entries = next;
		groups = groupEntries(next);
		popup?.remove();
		map.getSource<GeoJSONSource>(sourceId)?.setData(geojson(groups));
		fitEntries();
	}

	async function expandCluster(event: MapMouseEvent) {
		const feature = map.queryRenderedFeatures(event.point, { layers: [clusterLayer] })[0];
		const source = map.getSource<GeoJSONSource>(sourceId);
		if (!source || feature?.geometry.type !== 'Point') return;
		try {
			const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id);
			if (map.getSource(sourceId) !== source) return;
			map.jumpTo({
				center: [feature.geometry.coordinates[0]!, feature.geometry.coordinates[1]!],
				zoom
			});
		} catch {
			// A filter or theme change can replace the source while the worker resolves the cluster.
		}
	}

	if (entries) {
		if (!camera) fitEntries();
		map.on('click', clusterLayer, expandCluster);
		map.on('click', markerLayer, (event) => {
			const feature = event.features?.[0];
			const events = groups.get(feature?.properties.key);
			if (!events?.length) return;
			const content = document.createElement('div');
			content.className = 'event-map-group';
			for (const entry of events) content.append(popupContent(entry));
			popup?.remove();
			popup = new Popup({ offset: 27, maxWidth: '18rem' })
				.setLngLat(coordinate(events[0]!))
				.setDOMContent(content)
				.addTo(map);
		});
		for (const layer of [clusterLayer, markerLayer]) {
			map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
			map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
		}
	} else if (onPick) {
		map.on('click', (event) => publish(event.lngLat.wrap()));
	}

	const applyTheme = () => {
		const next = isDark();
		if (next === dark) return;
		dark = next;
		map.setStyle(style());
	};
	const observer = new MutationObserver(applyTheme);
	observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
	systemTheme.addEventListener('change', applyTheme);

	return {
		setEntries,
		setPosition,
		camera(): Camera {
			const { lng, lat } = map.getCenter();
			return { center: [lng, lat], zoom: map.getZoom() };
		},
		remove() {
			observer.disconnect();
			systemTheme.removeEventListener('change', applyTheme);
			popup?.remove();
			marker?.remove();
			map.remove();
		}
	};
}
