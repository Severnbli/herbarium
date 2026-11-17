import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

// Disable unsupported syntax at the parser too; raw HTML and images never render.
const markdown = new MarkdownIt('zero', { html: false, breaks: true, linkify: false }).enable([
	'paragraph',
	'text',
	'newline',
	'escape',
	'backticks',
	'emphasis',
	'link',
	'list',
	'entity'
]);
markdown.disable('backticks');

/** Only this server-sanitized result may enter Svelte's HTML rendering escape hatch. */
export function renderNotes(source: string): string {
	return sanitizeHtml(markdown.render(source), {
		allowedTags: ['p', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'br'],
		allowedAttributes: { a: ['href', 'rel'] },
		allowedSchemes: ['http', 'https', 'mailto'],
		allowProtocolRelative: false,
		transformTags: {
			a: (tagName, attributes) => ({
				tagName,
				attribs: { href: attributes.href ?? '', rel: 'noopener noreferrer' }
			})
		}
	});
}
