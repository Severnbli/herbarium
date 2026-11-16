import { building, dev } from '$app/env';
import type { ServerInit } from '@sveltejs/kit/hooks';
import { ConfigError, initConfig } from '#lib/server/config.ts';

export const init: ServerInit = () => {
	if (building) return;

	try {
		initConfig(process.env, { production: !dev });
	} catch (error) {
		if (error instanceof ConfigError) {
			// The message lists variable names and rules only, never secret values.
			console.error(error.message);
			process.exit(1);
		}
		throw error;
	}
};
