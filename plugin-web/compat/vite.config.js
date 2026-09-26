import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'index.js',
      formats: ['es'],
      fileName: () => 'index.js',
    },
  },
})
