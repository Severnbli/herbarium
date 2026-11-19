export type Coordinates = { lat: number; lon: number };

export type GazetteerPlace = Coordinates & { id: number; name: string; country: string };

export function readCoordinate(value: string, min: number, max: number): number | null {
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
	const number = Number(value);
	return number >= min && number <= max ? number : null;
}

export function readCoordinates(latText: string, lonText: string): Coordinates | null {
	const lat = readCoordinate(latText.trim(), -90, 90);
	const lon = readCoordinate(lonText.trim(), -180, 180);
	return lat === null || lon === null ? null : { lat, lon };
}

export function coordinatePair(value: string): Coordinates | null {
	const parts = value.trim().split(/\s*[,;]\s*|\s+/);
	return parts.length === 2 ? readCoordinates(parts[0]!, parts[1]!) : null;
}
