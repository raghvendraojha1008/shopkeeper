import { defineConfig, ConfigEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }: ConfigEnv) => {
  const isProd = command === 'build';

  return {
    plugins: [react()],

    server: {
      host: '0.0.0.0',
      port: 5000,
      allowedHosts: true,
      hmr: {
        clientPort: 443,
        protocol: 'wss',
        host: process.env.REPLIT_DEV_DOMAIN || 'localhost',
      },
    },

    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-is',
        'react-router-dom',
        '@tanstack/react-query',
        '@tanstack/react-query-persist-client',
        '@tanstack/query-async-storage-persister',
        'idb-keyval',
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
        // FINAL MODULE — UpdateBanner reads Capacitor.isNativePlatform()
        // to decide between Reload (web) and Open Store (native), so this
        // needs to be in the pre-bundle to avoid the optimize-deps desync
        // that hits whenever a new top-level dep enters the graph.
        '@capacitor/core',
        // Keyboard manager — pre-bundle so Vite never triggers a mid-session
        // dep re-optimisation that invalidates React chunk hashes and causes
        // the "Invalid hook call / multiple React instances" crash.
        '@capacitor/keyboard',
      ],
    },

    // Remove console logs in production
    ...(isProd
      ? {
          esbuild: {
            drop: ['console', 'debugger'] as ('console' | 'debugger')[],
          },
        }
      : {}),

    build: {
      chunkSizeWarningLimit: 1500,
      minify: 'esbuild',
      cssMinify: true,
      sourcemap: false,

      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {

              if (
                id.includes('react') ||
                id.includes('react-dom') ||
                id.includes('react-router-dom')
              ) {
                return 'vendor-react';
              }

              if (id.includes('@tanstack/react-query')) {
                return 'vendor-query';
              }

              if (id.includes('firebase')) {
                return 'vendor-firebase';
              }

              if (id.includes('recharts')) {
                return 'vendor-charts';
              }

              if (
                id.includes('jspdf') ||
                id.includes('jspdf-autotable') ||
                id.includes('html2canvas')
              ) {
                return 'vendor-pdf';
              }

              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }

              // fallback
              return 'vendor';
            }
          },
        },
      },
    },
  };
});