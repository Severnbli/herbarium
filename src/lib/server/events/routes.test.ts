import { describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load as listLoad } from '../../../routes/events/+page.server.ts';
import { load as newLoad, actions as newActions } from '../../../routes/events/new/+page.server.ts';
import {
	load as detailLoad,
	actions as detailActions
} from '../../../routes/events/[id]/+page.server.ts';
import {
	load as editLoad,
	actions as editActions
} from '../../../routes/events/[id]/edit/+page.server.ts';

describe('event route authorization boundaries', () => {
	const handlers = [
		listLoad,
		newLoad,
		detailLoad,
		editLoad,
		...Object.values(newActions),
		...Object.values(detailActions),
		...Object.values(editActions)
	];
	it.each(handlers.map((handler, index) => ({ handler, index })))(
		'checks the session before handler $index touches data',
		async ({ handler }) => {
			// A partial event is deliberate: an anonymous boundary must not access other request fields.
			const event = {
				locals: { user: null, session: null, locale: 'en' },
				url: new URL('https://herbarium.example/events')
			};
			let caught: unknown;
			try {
				await handler!(event as never);
			} catch (cause) {
				caught = cause;
			}
			expect(isRedirect(caught)).toBe(true);
			if (isRedirect(caught)) expect(caught.location).toBe('/login?next=%2Fevents');
		}
	);
});
