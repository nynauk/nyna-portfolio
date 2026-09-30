# NYNA

Website for **NYNA**: professional IT, web and hardware solutions in London. Live at [nyna.co.uk](https://nyna.co.uk).

## Structure
- `index.html`: the homepage. The page is drawn as one of NYNA's circuit boards, lit from behind by the cursor.
- `owc.html`, `trading-bot.html`, `autonomous-buggy.html`, `peg-dhcp-security.html`, `train-timetable.html`, `corporate-web.html`, `construction-website.html`, `accountancy-web.html`, `network-ring.html`, `email-hosting.html`, `computer-setup.html`: the case studies. They share the homepage's head, nav, footer and menus, so change those on `index.html` first and then carry the change across to every case study.
- `style.css`: every style, in light and dark themes.
- `main.js`: the board itself (copper routing, the light, the charges, the WebGL bench behind the board, the honeycomb cut-outs), plus the menus, cursor, work panel and enquiry form.
- `work.js`: case-study extras: the photo viewer, the 3D adapter viewer on `owc.html` and the strategy chart on `trading-bot.html`.
- `assets/`: self-hosted fonts (fixed-width Archivo instances and Unbounded), board renders, client logos and photo thumbnails.
- `projects/`: full-size case-study photos and renders, the buggy demo video, and `strategies.js` (chart data).
- `models/`: `.glb` models for the 3D adapter viewer.
- `icons/`, `site.webmanifest`: favicons, app icons and the social preview image.
- `boards/`, `logos/`: original source images; the site uses the optimised copies in `assets/`.
- `brand/`: brand guidelines PDF and social graphics.
- `vercel.json`: redirects the old `/draft` preview to `/` and sets long caching on static folders.

## Tech
Hand-coded HTML, CSS and JavaScript with no build step. three.js is loaded from a CDN on the OWC case study only. The site follows the visitor's light or dark setting until they pick one, and respects reduced motion.

## Deploy
Pushing to `main` deploys to Vercel as a static site served from the repository root.
