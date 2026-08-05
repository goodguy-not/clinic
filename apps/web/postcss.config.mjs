/**
 * Tailwind CSS v4 is configured in CSS, not JavaScript: this file exists only
 * to register the PostCSS plugin, and `src/app/globals.css` holds the theme.
 * There is deliberately no `tailwind.config.ts` — in v4 that file is the
 * legacy path.
 *
 * Nothing here reaches the browser as JavaScript. Tailwind runs at build time
 * and emits CSS, so adding it does not move the application away from Server
 * Components or introduce a client bundle.
 *
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
