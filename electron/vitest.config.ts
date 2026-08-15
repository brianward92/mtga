import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Vitest runs under system Node while the canonical better-sqlite3 is
      // compiled for Electron's ABI (postinstall electron-rebuild). Tests use
      // better-sqlite3-node — an npm-alias second install of the same package
      // whose prebuild matches the system Node — so `npm test` and
      // `npm run dev` work back-to-back without rebuild flip-flopping.
      'better-sqlite3': 'better-sqlite3-node'
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
