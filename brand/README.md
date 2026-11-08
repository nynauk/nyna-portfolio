# NYNA brand kit

Brand assets for NYNA (nyna.co.uk). Use these for anything that represents the brand: social
profiles, decks, documents, ads.

## Brand guidelines

- **`NYNA-Brand-Guidelines.pdf`**: revision 2.1, ten A4 sheets. The idea, the wordmark, both
  palettes, type, the board and its parts, components, motion, voice and contact. The text can be
  searched and the hex values copied. Share it with any designer or collaborator before they
  produce NYNA-branded work.

The guide is drawn by the site's own board engine and reads its colours from the site's stylesheet,
so it cannot drift from the site. Rebuild it with `node _brand_guide.mjs`.

## Social kit (`/social/backlit`)

Drawn by the live site's board engine, so everything matches nyna.co.uk exactly. Suggested captions,
and notes on posting, are in `CAPTIONS.md`.

| File | Size (px) | Use |
|------|-----------|-----|
| `instagram-01-intro.jpg` | 2160 x 2700 | Who NYNA is |
| `instagram-02-services.jpg` | 2160 x 2700 | The four services |
| `instagram-03-hardware.jpg` | 2160 x 2700 | PCB design |
| `instagram-04-project.jpg` | 2160 x 2700 | The optical link project |
| `instagram-05-contact.jpg` | 2160 x 2700 | Contact details |
| `instagram-06-new-site.jpg` | 2160 x 2700 | The launch: the old site beside the new one |
| `instagram-07-light.jpg` | 2160 x 2700 | What the new site is: copper lit from behind |
| `instagram-08-circuits.jpg` | 2160 x 2700 | The working circuits on the site |
| `instagram-09-quote.jpg` | 2160 x 2700 | A client's words |
| `instagram-10-why.jpg` | 2160 x 2700 | The four pillars |
| `story-01-intro.jpg` | 2160 x 3840 | Story: who NYNA is (also the closing card of the launch video) |
| `story-02-services.jpg`, `-05-contact`, `-06-new-site`, `-07-light`, `-08-circuits` | 2160 x 3840 | Story versions of those posts, laid out clear of Instagram's own controls |
| `instagram-08-circuits.mp4` | 2160 x 2700, 60 fps | The circuits post, moving (10 s, loops, no sound). `-1080.mp4` is the same at 1080 wide |
| `nyna-new-site-4k.mp4` | 2160 x 3840, 60 fps | Launch video (29 s, no sound): the old site gives way to the new one, filmed from the site itself |
| `nyna-new-site-1080.mp4` | 1080 x 1920, 60 fps | The same film at 1080 wide |
| `linkedin-banner.png` | 3168 x 792 | LinkedIn banner, at twice the size it is shown; the name and line sit in the middle band, so a company page's wider crop keeps them |
| `link-preview.png` | 1200 x 630 | The card a link to the site unfolds into (installed as `icons/og.png`) |

**4K.** Posts and stories are made at twice the size Instagram shows, so they stay sharp wherever
they are used. Platforms scale them down themselves.

**HDR.** Each JPEG carries a second, grey picture (a gain map, in the Ultra HDR layout) that marks
where the light is: the lamp, lit copper, charges and LEDs. On a screen and in an app with HDR
those are shown brighter than white, by up to two stops. Everywhere else the file is an ordinary
JPEG and looks exactly as it always did. The videos are standard dynamic range.

**Regenerating.** With the local preview running on port 8123, from the `artifacts` folder:

- `node _social_gen.mjs` makes every still (add part of a name to make only those). It captures
  each one with its lights on and off, and `_social_hdr.py` builds the HDR JPEG from the difference.
- `node _social_motion.mjs instagram-08-circuits` films a post as a looping video.
- `node _social_video.mjs` films the launch video at 1080, and with `--4k` at 4K.

## Colour

Read from `style.css`, which is the source of truth. Every colour is a material, and blue is light.

| | White solder mask | Black solder mask | Role |
|---|---|---|---|
| Mask | `#ECF2F4` | `#0E1824` | The board: page background |
| Silk | `#09111B` | `#F2F2F2` | Ink: headlines, lines, solid keys |
| Ink 2 | `#2F4351` | `#ACBECE` | Body text |
| Ink 3 | `#4B6474` | `#8399AD` | Labels and captions |
| Pad | `#ADBBC3` | `#758795` | Tin finish: pads, pins, vias |
| Bench | `#122236` | `#05090F` | What the board sits on |
| Glow | `#1FC0FF` | `#1FC0FF` | NYNA blue: the lamp, charges, LED halo |
| Accent | `#008EDB` | `#1FC0FF` | Links and focus |
| LED | `#00B0FC` | `#AEE8FF` | A lit LED |
| Error | `#AD0703` | `#FF8F85` | The one other colour |

White is the default. Blue is never a background and never the colour of body text. Photographs
and board renders are shown with saturation 1.22.

## Typography

- **Unbounded Medium**: the NYNA wordmark, and nothing else.
- **Archivo Wide**, 570 to 600: headlines, part names, and the labels printed on the board.
- **Archivo**, 400 to 600: everything that is read.

The fonts are hosted with the site in `assets/fonts`.

## Wordmark

Four letters in Unbounded Medium, tracked out by six percent, in one flat colour. Keep clear space
equal to the height of the N on every side. Do not stretch it, tilt it, recolour it or add effects.

## Earlier graphics (`/social`)

The six PNGs directly in `/social` (`instagram-post-01-logo.png`, `instagram-post-02-services.png`,
`instagram-story.png`, `linkedin-banner.png`, `twitter-header.png`, `profile-avatar.png`) are from
the previous identity. Use the `backlit` set instead; they are kept only for reference.
