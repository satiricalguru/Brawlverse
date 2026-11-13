import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two pages: the landing site at / and the game at /play/.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        play: resolve(import.meta.dirname, 'play/index.html'),
      },
    },
  },
});
