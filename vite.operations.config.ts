import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		ssr: 'src/lib/server/archive/restore-cli.ts',
		outDir: 'build/operations',
		rollupOptions: { output: { entryFileNames: 'restore.js' } }
	}
});
