# Boardy — Brand Assets

Handoff package for Claude Code (or any frontend setup).

## Files

| File | Use |
| --- | --- |
| `boardy-favicon.ico` | Multi-size favicon (16, 32, 48, 64 px). Drop in site root, link with `<link rel="icon" href="/favicon.ico">`. |
| `boardy-mark.svg` | The symbol only. Square, 100×100 viewBox. Use for app icons, social avatars, OG images. |
| `boardy-logo.svg` | Full horizontal lockup (mark + wordmark). Use in navbars, footers, email signatures. |
| `boardy-tokens.json` | All design tokens: colors, typography, spacing, radii, shadows, logo specs, component hints. |
| `favicon-{16,32,48,64,128,256}.png` | Individual PNG exports. Useful for `apple-touch-icon` (use 180 or upscale 128), Android chrome icons, etc. |

## Suggested HTML head

```html
<link rel="icon" href="/boardy-favicon.ico" sizes="any">
<link rel="icon" href="/boardy-mark.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/favicon-256.png">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

## Navbar usage

```html
<a href="/" class="brand">
  <img src="/boardy-logo.svg" alt="Boardy" height="32">
</a>
```

The lockup SVG renders the wordmark via `<text>` with `font-family: "Inter Tight"`. **Make sure Inter Tight is loaded** in the page CSS, otherwise the wordmark falls back to system-ui. If you need a font-independent SVG, ask for an outlined version.

## Design tokens

`boardy-tokens.json` is the source of truth. Highlights:

- **Ink** `#1A1916` — text + brand mark background
- **Terracota** `#D97757` — the dot. The single accent. Use for active items, completed checks, primary CTAs, focus rings.
- **Cream** `#F1ECE1` — page background (light theme)
- **Paper** `#F6F5F0` — cards/surfaces
- **Sage** `#D8DFD1` — secondary soft sections

Type: **Inter Tight** (UI) + **JetBrains Mono** (tags/timestamps/code).

Wordmark spec: `B + terracota-circle(0.6 × font-size) + ardy`, letter-spacing `-0.045em`.

## License / ownership

Internal Boardy brand assets. Use freely within the product.
