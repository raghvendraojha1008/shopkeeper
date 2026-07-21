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
      watch: {
        // Exclude bun's install cache and other non-source directories
        // to avoid hitting the OS inotify file-watcher limit (ENOSPC).
        ignored: ['**/.cache/**', '**/node_modules/**', '**/.git/**'],
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
      // jsPDF & jspdf-autotable are CJS packages whose dependencies (canvg,
      // @xmldom/xmldom) have DOM side-effects that corrupt React's module-init
      // graph when Vite pre-bundles them at startup.  Excluding them means
      // Vite transforms them on-demand (only when a PDF is actually generated),
      // which is safe because PDF generation never happens at app boot.
      exclude: ['jspdf', 'jspdf-autotable'],
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
      // Increase parallelism during minification
      target: 'esnext',

      rollupOptions: {
        output: {
          // Keep lazy-loaded views in their own chunks so they're only downloaded when needed
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (
                id.includes('react/') ||
                id.includes('react-dom') ||
                id.includes('react-router-dom') ||
                id.includes('scheduler')
              ) {
                return 'vendor-react';
              }

              if (
                id.includes('@tanstack/react-query') ||
                id.includes('@tanstack/query') ||
                id.includes('idb-keyval')
              ) {
                return 'vendor-query';
              }

              if (id.includes('firebase')) {
                return 'vendor-firebase';
              }

              if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) {
                return 'vendor-charts';
              }

              if (
                id.includes('/jspdf/') ||
                id.includes('jspdf-autotable') ||
                id.includes('html2canvas')
              ) {
                return 'vendor-pdf';
              }

              if (id.includes('lucide-react')) {
                return 'vendor-icons';
              }

              if (id.includes('react-virtuoso')) {
                return 'vendor-virtuoso';
              }

              if (id.includes('@capacitor')) {
                return 'vendor-capacitor';
              }

              // fallback — all other node_modules in one vendor chunk
              return 'vendor';
            }
          },
        },
      },
    },
  };
});
