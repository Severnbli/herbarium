export interface ByteRange {
	start: number;
	end: number;
}

// A single range is sufficient for browser playback and PMTiles. Ignore unknown units.
export function parseRange(value: string | null, size: number): ByteRange | null | false {
	if (!value?.toLowerCase().startsWith('bytes=')) return null;
	const match = /^bytes=(\d{0,20})-(\d{0,20})$/i.exec(value);
	if (size === 0 || !match || (!match[1] && !match[2])) return false;
	if (!match[1]) {
		const suffix = Number(match[2]);
		return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : false;
	}
	const start = Number(match[1]);
	const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
	return start < size && end >= start ? { start, end } : false;
}
