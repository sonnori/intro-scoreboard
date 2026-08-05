import { defineConfig } from 'vite';

/**
 * The shoot machine gets one file it can double-click, so the build inlines
 * everything — fonts included — and emits a classic IIFE instead of an ES
 * module. Module scripts are the one thing browsers refuse to run over
 * file://; a plain script runs there fine.
 *
 * `npm run app` finishes the job in scripts/bundle.mjs.
 */
// Only the standalone build swallows the photos as base64. A hosted build
// keeps them as separate cached files instead of bloating the bundle.
const standalone = process.env.SINGLE_FILE === '1';

export default defineConfig({
  build: {
    assetsInlineLimit: standalone ? 8 * 1024 * 1024 : 4096,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        // Fixed names for the standalone build because scripts/bundle.mjs
        // inlines them by name; content hashes for hosting so a redeploy can
        // never serve a cached photo or stylesheet from the previous taping.
        entryFileNames: standalone ? 'app.js' : 'assets/app-[hash].js',
        assetFileNames: standalone ? 'app.[ext]' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
