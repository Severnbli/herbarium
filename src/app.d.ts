import type { Locale } from '#lib/i18n/index.ts';
import type { SessionUser } from '#lib/server/auth/session.ts';

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Error {
			message: string;
			/** Correlates a generic error page with the server log entry. */
			id?: string;
		}
		interface Locals {
			locale: Locale;
			/** The signed-in member; null when anonymous or still waiting for the second factor. */
			user: SessionUser | null;
			session: { id: string; mfaPending: boolean } | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
