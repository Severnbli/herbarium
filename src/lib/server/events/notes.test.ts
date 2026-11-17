import { describe, expect, it } from 'vitest';
import { renderNotes } from './notes.ts';
describe('limited Markdown notes', () => {
	it('renders only supported formatting and secures links', () => {
		const html = renderNotes(
			'**bold** *italic*\nnext\n\n- one\n- two\n\n1. first\n\n[link](https://example.com)'
		);
		for (const tag of [
			'<strong>bold</strong>',
			'<em>italic</em>',
			'<br',
			'<ul>',
			'<ol>',
			'rel="noopener noreferrer"'
		])
			expect(html).toContain(tag);
	});
	it.each([
		'<script>alert(1)</script>',
		'<img src=x onerror=alert(1)>',
		'<svg/onload=alert(1)>',
		'<a href="javascript:alert(1)">bad</a>',
		'[bad](javascript:alert%281%29)',
		'[bad](JaVaScRiPt:alert(1))',
		'[bad](data:text/html;base64,PHNjcmlwdD4=)',
		'[bad](vbscript:test)',
		'[bad](//example.com)',
		'[bad](&#106;avascript:alert(1))',
		'![image](https://example.com/pixel)',
		'<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
		'[link](https://example.com "onmouseover=alert(1)")'
	])('prevents active content in %s', (value) => {
		const html = renderNotes(value);
		expect(html).not.toMatch(/<(?:script|img|svg|math|style|iframe|object|video)\b/i);
		expect(html).not.toMatch(/<[^>]+\s(?:on\w+|style|src|title)=/i);
		expect(html).not.toMatch(/<a\b[^>]*href="(?:javascript:|data:|vbscript:|\/\/)/i);
	});
	it('leaves unsupported headings, code and tables as text', () => {
		const html = renderNotes('# Title\n\n`code`\n\n| a | b |');
		expect(html).not.toMatch(/<(?:h1|code|table)\b/);
		expect(html).toContain('# Title');
	});
});
