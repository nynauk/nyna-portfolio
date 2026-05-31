# NYNA — Portfolio & Business Site

Static marketing and portfolio site for **NYNA** — professional IT, web & hardware solutions, London.

## Structure
- `index.html` — homepage: WebGL wave hero, services, hardware/PCB showcase (per-board colour glow), selected work grid, skills, contact.
- `owc.html` — Optical Wireless Communication dissertation case study, with an interactive 3D adapter viewer.
- `trading-bot.html`, `corporate-web.html`, `construction-website.html`, `baby-soother.html`, `train-timetable.html`, `temperature-sensor.html`, `network-ring.html`, `accountancy-web.html`, `email-hosting.html`, `computer-setup.html` — individual work case-study pages (placeholder content for now).
- `models/` — `.glb` 3D adapter models.
- `projects/` — case-study photos, CAD renders, scope captures, schematics.
- `boards/` — PCB top-view renders for the hardware switcher.
- `logos/` — client logos.
- `vercel.json` — static hosting config (long-cache headers for assets).

## Tech
Hand-coded HTML / CSS / JS. Three.js, GSAP + ScrollTrigger and Lenis are loaded via CDN. No build step. Includes a dark/light theme toggle (in the footer) and a custom cursor.

## Deploy (Vercel)
Import this repo into Vercel. No framework preset or build command is required — it deploys as a static site served from the repository root (`index.html`). `vercel.json` applies caching headers to the asset folders.
