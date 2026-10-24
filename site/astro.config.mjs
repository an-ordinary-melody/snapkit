import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

// Vercel sets the production domain at build time; canonical links, the sitemap and the share image use it.
const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? 'snapkit-app.vercel.app'

export default defineConfig({
  site: `https://${domain}`,
  integrations: [react(), sitemap({ filter: (page) => !page.endsWith('/og/') })],
  // Lightning CSS (Vite's default minifier) keeps only one of backdrop-filter / -webkit-backdrop-filter,
  // which drops the blur in either Chrome or Safari. esbuild keeps both.
  vite: { build: { cssMinify: 'esbuild' } }
})
