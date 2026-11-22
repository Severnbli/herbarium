import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	return {
		locale: locals.locale,
		user: locals.user ? { displayName: locals.user.displayName, role: locals.user.role } : null
	};
};
