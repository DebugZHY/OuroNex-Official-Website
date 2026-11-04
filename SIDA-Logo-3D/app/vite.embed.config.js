import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: 'src/embed.js',
      name: 'SidaLogo3D',
      formats: ['iife'],
      fileName: () => 'sida-3d.js',
    },
    outDir: 'dist-embed',
    emptyOutDir: true,
    minify: 'esbuild',
    target: 'es2020',
    reportCompressedSize: true,
  },
});
