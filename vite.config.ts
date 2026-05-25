import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: { target: 'ES2022' },
  server: { port: 5173 }
})
