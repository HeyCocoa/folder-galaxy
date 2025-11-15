import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    main: 'src/main/main.ts',
    preload: 'src/main/preload.ts'
  },
  outDir: 'dist/main',
  target: 'node18',
  platform: 'node',
  format: ['cjs'],
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
  external: ['electron'],
});
