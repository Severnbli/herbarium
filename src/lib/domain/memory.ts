export interface MemoryCard {
	id: string;
	originalName: string;
	altText: string;
	caption: string;
	sortDate: string;
	isVideo: boolean;
}

export interface MemoryGroup {
	event: { id: string; title: string } | null;
	rows: MemoryCard[];
}
