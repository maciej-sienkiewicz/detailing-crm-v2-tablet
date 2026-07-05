import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // sockjs-client odwołuje się do `global` (dziedzictwo Node) — mapujemy na globalThis
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['sockjs-client'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
