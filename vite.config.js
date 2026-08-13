import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' garante que o dist/ funcione aberto de qualquer pasta,
// inclusive via file:// ou copiado para um share de rede.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    open: true,
  },
})