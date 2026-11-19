import { defineConfig } from 'drizzle-kit';

// Only used to generate migrations from the schema (`npm run db:generate`). The app applies them
// itself on startup, so drizzle-kit never needs the database or the key.
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	casing: 'snake_case',
	strict: true
});
