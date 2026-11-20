import { DARK, LIGHT, language_script_pairs, layers, type Flavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import type { Locale } from '#lib/i18n/index.ts';

// Protomaps uses a Latin fallback for languages missing from its script table.
if (!language_script_pairs.some(({ lang }) => lang === 'be')) {
	language_script_pairs.push({ lang: 'be', full_name: 'Belarusian', script: 'Cyrillic' });
}

export const palette = {
	light: {
		land: '#eee8da',
		water: '#a9c4dc',
		forest: '#bdc9a6',
		park: '#cdd8b2',
		building: '#af9a85',
		road: '#fff9ed',
		roadCasing: '#b0a08a',
		highway: '#efcf91',
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
		park: '#3b5140',
		building: '#64706d',
		road: '#56646a',
		roadCasing: '#29363d',
		highway: '#886d47',
		border: '#7a8176',
		label: '#f0ead9',
		halo: '#141f24',
		cluster: '#a6c7a4',
		clusterText: '#141f24',
		pin: '#f1a2a2'
	}
};

export const mapFont = ['Noto Sans Regular'];

function mapFlavor(dark: boolean): Flavor {
	const base = dark ? DARK : LIGHT;
	const colors = palette[dark ? 'dark' : 'light'];
	return {
		...base,
		background: colors.water,
		earth: colors.land,
		water: colors.water,
		park_a: colors.park,
		park_b: colors.forest,
		wood_a: colors.park,
		wood_b: colors.forest,
		landcover: base.landcover && {
			...base.landcover,
			forest: colors.forest,
			grassland: colors.park
		},
		buildings: colors.building,
		boundaries: colors.border,
		minor_service: colors.road,
		minor_a: colors.road,
		minor_b: colors.road,
		major: colors.road,
		highway: colors.highway,
		minor_service_casing: colors.roadCasing,
		minor_casing: colors.roadCasing,
		major_casing_early: colors.roadCasing,
		major_casing_late: colors.roadCasing,
		highway_casing_early: colors.roadCasing,
		highway_casing_late: colors.roadCasing,
		bridges_minor: colors.road,
		bridges_major: colors.road,
		bridges_highway: colors.highway,
		roads_label_minor: colors.label,
		roads_label_minor_halo: colors.halo,
		roads_label_major: colors.label,
		roads_label_major_halo: colors.halo,
		subplace_label: colors.label,
		subplace_label_halo: colors.halo,
		city_label: colors.label,
		city_label_halo: colors.halo,
		state_label: colors.label,
		state_label_halo: colors.halo,
		country_label: colors.label,
		address_label: colors.label,
		address_label_halo: colors.halo
	};
}

export function mapStyle(
	assets: string,
	locale: Locale,
	basemap: boolean,
	dark: boolean
): StyleSpecification {
	const markers = { id: 'events', url: `${assets}/markers` };
	const style: StyleSpecification = {
		version: 8,
		glyphs: `${assets}/glyphs/{fontstack}/{range}.pbf`,
		sprite: [markers],
		sources: {},
		layers: [
			{
				id: 'paper',
				type: 'background',
				paint: { 'background-color': palette[dark ? 'dark' : 'light'].land }
			}
		]
	};
	if (!basemap) return style;

	const theme = dark ? 'dark' : 'light';
	style.sprite = [{ id: 'default', url: `${assets}/protomaps-${theme}` }, markers];
	style.sources.basemap = { type: 'vector', url: `pmtiles://${assets}/basemap.pmtiles` };
	style.layers = layers('basemap', mapFlavor(dark), { lang: locale });
	return style;
}
