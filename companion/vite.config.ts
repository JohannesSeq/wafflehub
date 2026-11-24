import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    host: '0.0.0.0', port: 5174, strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.data/**', '**/.sites-runtime/**', '**/.sites-checkout/**'] },
    proxy: { '/api': { target: 'http://127.0.0.1:3002', changeOrigin: false } },
  },
});
