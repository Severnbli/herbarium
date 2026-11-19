import type { StyleSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { Locale } from '#lib/i18n/index.ts';

export const palette = {
	light: {
		land: '#eee8da',
		water: '#a9c4dc',
		forest: '#bdc9a6',
		road: '#827666',
		border: '#92826e',
		label: '#302c26',
		halo: '#fffcf4',
		cluster: '#426045',
		clusterText: '#fffcf4',
		pin: '#983a3d'
	},
	dark: {
		land: '#1c2b2d',
		water: '#243956',
		forest: '#2e463a',
		road: '#8e8d81',
		border: '#7a8176',
		label: '#f0ead9',
		halo: '#141f24',
		cluster: '#a6c7a4',
		clusterText: '#141f24',
		pin: '#f1a2a2'
	}
};

export const mapFont = ['Noto Sans Regular'];

export function mapStyle(
	assets: string,
	locale: Locale,
	basemap: boolean,
	dark: boolean
): StyleSpecification {
	const colors = palette[dark ? 'dark' : 'light'];
	const style: StyleSpecification = {
		version: 8,
		glyphs: `${assets}/glyphs/{fontstack}/{range}.pbf`,
		sprite: `${assets}/markers`,
		sources: {},
		layers: [{ id: 'paper', type: 'background', paint: { 'background-color': colors.land } }]
	};
	if (!basemap) return style;

	const label: SymbolLayerSpecification['layout'] = {
		'text-field': ['coalesce', ['get', `name:${locale}`], ['get', 'name:en'], ['get', 'name'], ''],
		'text-font': mapFont
	};
	const labelPaint = {
		'text-color': colors.label,
		'text-halo-color': colors.halo,
		'text-halo-width': 1.4
	};
	style.sources.basemap = { type: 'vector', url: `pmtiles://${assets}/basemap.pmtiles` };
	style.layers = [
		{ id: 'sea', type: 'background', paint: { 'background-color': colors.water } },
		{
			id: 'land',
			type: 'fill',
			source: 'basemap',
			'source-layer': 'earth',
			paint: { 'fill-color': colors.land }
		},
		{
			id: 'forest-cover',
			type: 'fill',
			source: 'basemap',
			'source-layer': 'landcover',
			filter: ['==', ['get', 'kind'], 'forest'],
			paint: { 'fill-color': colors.forest }
		},
		{
			id: 'green-spaces',
			type: 'fill',
			source: 'basemap',
			'source-layer': 'landuse',
			filter: [
				'in',
				['get', 'kind'],
				['literal', ['forest', 'wood', 'park', 'garden', 'nature_reserve']]
			],
			paint: { 'fill-color': colors.forest }
		},
		{
			id: 'water',
			type: 'fill',
			source: 'basemap',
			'source-layer': 'water',
			filter: ['==', ['geometry-type'], 'Polygon'],
			paint: { 'fill-color': colors.water }
		},
		{
			id: 'waterways',
			type: 'line',
			source: 'basemap',
			'source-layer': 'water',
			filter: ['==', ['geometry-type'], 'LineString'],
			paint: { 'line-color': colors.water, 'line-width': 1.3 }
		},
		{
			id: 'boundaries',
			type: 'line',
			source: 'basemap',
			'source-layer': 'boundaries',
			filter: ['==', ['get', 'kind'], 'country'],
			paint: { 'line-color': colors.border, 'line-width': 1, 'line-dasharray': [3, 2] }
		},
		{
			id: 'roads',
			type: 'line',
			source: 'basemap',
			'source-layer': 'roads',
			minzoom: 5,
			filter: ['!=', ['get', 'kind'], 'rail'],
			paint: {
				'line-color': colors.road,
				'line-opacity': 0.65,
				'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.35, 11, 0.8, 16, 2.1]
			}
		},
		{
			id: 'street-labels',
			type: 'symbol',
			source: 'basemap',
			'source-layer': 'roads',
			minzoom: 13,
			layout: { ...label, 'symbol-placement': 'line', 'text-size': 11, 'symbol-spacing': 320 },
			paint: labelPaint
		},
		{
			id: 'places',
			type: 'symbol',
			source: 'basemap',
			'source-layer': 'places',
			layout: {
				...label,
				'symbol-sort-key': ['coalesce', ['get', 'sort_rank'], 10000],
				'text-size': ['match', ['get', 'kind'], 'country', 15, 'locality', 13, 11]
			},
			paint: labelPaint
		}
	];
	return style;
}
