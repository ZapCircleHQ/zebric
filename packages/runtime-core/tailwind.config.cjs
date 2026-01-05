const path = require('node:path')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, 'src/**/*.{ts,js,tsx,jsx}'),
    path.join(__dirname, 'src/renderer/**/*.liquid')
  ],
  theme: {
    extend: {}
  },
  corePlugins: {
    preflight: true
  }
}
