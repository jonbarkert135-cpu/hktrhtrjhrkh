import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // Route chunks come from React.lazy() in src/app/router.tsx; this only splits the
    // stable vendor half so route chunks stay small (initial JS budget, P1 §7).
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@trpc/client', '@trpc/react-query', '@tanstack/react-query', 'superjson'],
        },
      },
    },
  },
  server: { port: 5173 },
});
