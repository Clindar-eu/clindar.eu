# Clindar.eu — Claude Code Instructions

This file is read automatically by Claude Code. It defines coding standards, design tokens, and component rules for the Clindar.eu project.

---

## What is Clindar

Clindar is a clinical-data software company building accessible CDISC validation and submission-readiness infrastructure for CROs and lean biotech teams. Its core product is the Clindar Validator. Expert services provide focused support for CDISC delivery, audit and remediation, and submission programming and automation where specialist human judgement is required. Target users include clinical data managers, statistical programmers and biotech teams preparing FDA or EMA submissions.

Treat Clindar as a product-led software company in all website copy and design decisions. Do not position it as a general CRO, FSP, staffing provider, full-service clinical data-management company or generic programming consultancy. Services should complement the Validator rather than compete with it for prominence.

**Tagline:** Clinical data, submission-ready.

---

## Tech Stack

> Update this section to match your actual stack as the project evolves.

- Framework: [e.g. Next.js / Astro / SvelteKit]
- Styling: [e.g. Tailwind CSS / CSS Modules]
- Language: [e.g. TypeScript]
- Icons: Lucide
- Fonts: Inter (headings + body), JetBrains Mono (code/data)

---

## Design Tokens

Use these values consistently across all components. Do not invent new colors.

```css
/* Backgrounds */
--color-bg-white:       #FFFFFF;
--color-bg-slate:       #F4F6FA;
--color-bg-dark:        #0B1F3A;

/* Text */
--color-text-primary:   #111827;
--color-text-secondary: #6B7280;
--color-text-muted:     #94A3B8;
--color-text-white:     #FFFFFF;

/* Accent */
--color-accent:         #1D72E8;
--color-accent-hover:   #1558C0;
--color-accent-light:   #0EA5E9;

/* Feedback */
--color-success:        #10B981;

/* Borders */
--color-border:         #E5E7EB;

/* Typography */
--font-sans:            'Inter', sans-serif;
--font-mono:            'JetBrains Mono', monospace;

/* Spacing scale */
--section-padding-y:    80px;   /* 120px for hero */
--content-max-width:    1200px;
--border-radius:        6px;    /* 8px max */
```

---

## Component Rules

### General
- Max content width: `1200px`, always centered
- Sections alternate: white → light slate → white → light slate
- Hero and footer always use dark navy (`#0B1F3A`)
- No gradients, no glassmorphism, no blob shapes
- Border-radius max `8px` on cards and buttons
- No heavy box shadows — use `1px solid #E5E7EB` borders on cards instead

### Buttons
```
Primary:   bg #1D72E8, text white, hover bg #1558C0, radius 6px, px-6 py-3
Secondary: border 1px white, text white, hover bg white/10 (for dark backgrounds)
           border 1px #1D72E8, text #1D72E8, hover bg #EFF6FF (for light backgrounds)
```

### Cards
```
bg white, border 1px #E5E7EB, radius 6px, padding 24–32px
Icon: Lucide outline, 24px, color #1D72E8
Heading: bold, 20px, #111827
Body: regular, 16px, #6B7280, line-height 1.6
```

### Navigation
```
Sticky, bg white, border-bottom 1px #E5E7EB
Logo: left
Links: center or right, text #111827, hover text #1D72E8
CTA button: primary style, right-aligned
```

### Hero Section
```
bg #0B1F3A
Headline: bold, 48–64px, white
Subheadline: regular, 20px, #94A3B8
CTA row: primary button + secondary outlined white button
Optional trust badge: small, #94A3B8 text
No stock images — use typographic or abstract data-grid visuals only
```

### Footer
```
bg #0B1F3A
Text: white and #94A3B8
Layout: 3–4 columns (Product / Services / Company / Legal)
Include: EU hosting badge, GDPR note
```

---

## Homepage Section Order

1. Nav (sticky, white)
2. Hero (dark navy)
3. Trust strip — stats or key facts (light slate)
4. Problem statement (white)
5. Features grid — 3-col cards (light slate)
6. How it works — numbered steps (white)
7. Testimonials (light slate)
8. Mid-page CTA band (dark navy)
9. Expert services — focused support around the Validator, 2-col layout (white)
10. Final CTA (dark navy)
11. Footer (dark navy)

---

## What to Avoid

- Pastel colors or "wellness" aesthetics
- Heavy animations or parallax scrolling
- Stock photos of people in lab coats
- Emoji in UI (only allowed in markdown docs)
- Cluttered navigation
- Any pattern that looks "startup cute" rather than "clinical professional"
- Rounded corners above 8px
- More than 2 font weights in a single component

---

## Tone & Copy Style

- Precise and confident — no filler words
- Plain English — no jargon unless the audience (CDMs, programmers) expects it
- Short sentences, active voice
- CTAs: action-first ("Start validating", "Book a demo", "See how it works")

---

## Reference Sites

When in doubt, reference these for design decisions:
- veeva.com — whitespace, CTA patterns
- medidata.com — hero typography, metric blocks
- appsilon.com — credibility sections, pharma tone
- iqvia.com — structured layout, dark/light contrast
