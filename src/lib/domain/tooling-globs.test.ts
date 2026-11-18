import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { makeRe }: { makeRe: (pattern: string, options?: object) => RegExp } = createRequire(
	import.meta.url
)('picomatch');

describe('tooling glob matcher', () => {
	it('rejects both repetition operators even when optional recursion checks are disabled', () => {
		for (const operator of ['+', '*']) {
			expect(() => makeRe(`${operator}(txt)`, { maxExtglobRecursion: false })).toThrow(
				'Repeated extglobs are disabled'
			);
		}
	});

	it('continues to match standard globs and brace alternatives', () => {
		const matcher = makeRe('src/**/*.{ts,svelte}');
		expect(matcher.test('src/routes/example.svelte')).toBe(true);
		expect(matcher.test('src/routes/example.css')).toBe(false);
	});
});
