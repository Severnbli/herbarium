import type { Coordinates } from '#lib/domain/location.ts';

export type MapEntry = Coordinates & {
	id: string;
	pinId?: string;
	kind: 'moment' | 'plan' | 'occasion';
	title: string;
	date: string;
	place: string;
	preview: { id: string; label: string } | null;
};
