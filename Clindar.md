> **Note:** This file serves two purposes: (1) product documentation for Clindar.eu, and (2) a design brief for AI-assisted website generation. The design brief section starts after the horizontal rule marked "WEBSITE DESIGN BRIEF".

---

# Clindar

**Clinical data, submission-ready.**

Clindar builds CDISC validation and submission-readiness software for CROs and lean biotech teams — helping them move from raw trial data to clean, compliant, submission-ready datasets without enterprise-level complexity or cost.

---

## What we build

### 🔍 CDISC Validator *(in development)*
A web-based CDISC conformance validator for SDTM and ADaM datasets. Built to solve the real frustrations of day-to-day clinical data work:

- **Always-current rules** — conformance rules and CDISC Controlled Terminology update automatically, no manual downloads
- **In-browser data viewer** — inspect the exact offending rows directly in the app, no SAS session required
- **Plain-English fix suggestions** — each error comes with a clear explanation and actionable fix, not just a rule reference
- **Submission readiness score** — a clear quality metric per study, suitable for sponsor reporting
- **Team workspace** — shared issue tracking for CDM, programming, and sponsor teams in one place
- **GDPR-compliant by design** — EU-hosted, raw data deleted within 24 hours of validation

> Built for the teams who can't justify enterprise pricing but need enterprise-quality compliance checks.

---

## Who we are

Clindar is built on 15+ years of hands-on experience delivering CDISC-compliant submissions across global clinical trials — from first-in-human studies to pivotal Phase III packages.

---

## Who we work with

- **Small and mid-size CROs** needing scalable CDISC compliance tooling without enterprise contracts
- **Small biotech companies** preparing their first FDA or EMA submission without a full in-house biometrics function
- **Freelance statistical programmers and CDMs** who need professional-grade validation on a per-project basis

---

## Services

### Expert support when software isn't enough

Clindar combines modern validation software with specialist clinical-data expertise for the parts of submission readiness that still require human judgement.

- **Submission Readiness & CDISC Delivery** — SDTM, ADaM, Define-XML and submission outputs prepared, reviewed and validated for FDA and EMA submission.
- **CDISC Audit & Remediation** — Independent review, investigation and remediation of SDTM, ADaM and Define-XML before submission, inspection or transfer between vendors.
- **Submission Programming & Automation** — Targeted SAS, R and Python expertise for CDISC transformations, validation workflows, submission outputs and repeatable clinical-data automation.

> The software handles repeatable validation workflows; Clindar experts support complex remediation, submission preparation and specialised implementation where human judgement is valuable.

---

---

# WEBSITE DESIGN BRIEF
*For use when asking Claude or any AI tool to generate website designs, landing pages, or UI components for Clindar.eu*

---

## Design Inspiration

This design brief is derived from analysis of four reference websites that represent the desired visual direction:

| Site | Key takeaway |
|---|---|
| **Appsilon** (appsilon.com) | Pharma-focused tech, strong credibility blocks, numbered service sections |
| **IQVIA** (iqvia.com) | Enterprise authority, dark hero + white body, structured layout |
| **Veeva** (veeva.com) | Most minimal and confident, cleanest white space, best CTA patterns |
| **Medidata** (medidata.com) | Boldest typography, metric-driven hero, modern unified platform feel |

---

## Visual Style Summary

**Overall aesthetic:** Clean, high-contrast, professional. Minimal decoration. Data and trust-forward. Think Stripe meets life sciences — not a startup, not a legacy enterprise.

**Tone:** Precise, confident, approachable. Like a senior clinical programmer who also knows how to build good software.

---

## Color Palette

```
Primary background:     #FFFFFF  (white — dominant)
Secondary background:   #F4F6FA  (light slate — alternating sections)
Dark background:        #0B1F3A  (deep navy — hero section, footer)
Primary text:           #111827  (near-black)
Secondary text:         #6B7280  (slate gray — subheadings, captions)
Primary accent:         #1D72E8  (electric blue — CTAs, links, highlights)
Secondary accent:       #0EA5E9  (sky blue — hover states, badges)
Success/score:          #10B981  (green — submission readiness score indicators)
Border/divider:         #E5E7EB  (light gray)
```

---

## Typography

```
Headings:    Inter or Geist — Bold, 700 weight
             Large display: 48–64px
             Section headings: 32–40px
             Card headings: 20–24px

Body text:   Inter — Regular, 400 weight, 16–18px, line-height 1.6
Captions:    Inter — 14px, #6B7280
Monospace:   JetBrains Mono or Fira Code — for dataset/code references
```

---

## Layout Principles

1. **Wide white space** — generous padding between sections (80–120px vertical)
2. **Max content width:** 1200px, centered
3. **Grid:** 12-column, responsive. Cards in 3-col or 2-col grids
4. **No decorative clutter** — no gradients, blobs, or abstract shapes unless subtle and purposeful
5. **Sections alternate** between white (`#FFFFFF`) and light slate (`#F4F6FA`) backgrounds
6. **Hero section** uses dark navy (`#0B1F3A`) background with white text — like IQVIA and Veeva homepages
7. **No rounded-corner excess** — use subtle border-radius (6–8px max on cards and buttons)

---

## Component Style Guide

### Navigation
- Sticky top bar, white background, subtle bottom border
- Logo left, nav links center or right
- Single prominent CTA button ("Book a Demo" or "Start Validating") in primary accent blue
- Clean, no mega-menus — simple dropdowns if needed

### Hero Section
- Dark navy background (`#0B1F3A`)
- Large bold headline (48–64px), white
- One-line supporting subheadline in slate (`#94A3B8`)
- Two CTA buttons: primary (solid blue) + secondary (outlined white)
- Optional: small trust badge or stat (e.g., "15+ years of CDISC expertise")
- No stock photo heroes — prefer abstract data/grid visuals or pure typography

### Feature Cards
- White card on light slate background
- Icon (simple, line-style, blue) + bold heading + 2–3 line description
- No heavy drop shadows — use 1px border (`#E5E7EB`) instead
- 3-column grid on desktop, 1-column on mobile

### Stats / Social Proof Strip
- Light slate or dark navy background
- Large bold numbers (e.g., "15+ years", "SDTM + ADaM", "EU-hosted")
- Inspired by Medidata's metric-driven sections and Appsilon's credibility blocks

### CTA Sections
- Full-width, dark navy or accent blue background
- Short bold headline + one button
- Placed mid-page and at bottom — like Veeva's "Let's Partner" section

### Testimonials / Trust Signals
- White cards, clean quote format
- Include role + company type (e.g., "CDM Lead, Mid-size CRO")
- Similar pattern to Appsilon's client testimonials

### Footer
- Dark navy (`#0B1F3A`) background
- White text, organized in 3–4 columns (Product, Services, Company, Legal)
- Social links, EU hosting badge, GDPR note

---

## UI Tone & Interaction

- **Buttons:** solid primary (`#1D72E8`) with white text, hover darkens to `#1558C0`
- **Links:** blue, underline on hover only
- **Forms:** clean, 1px border inputs with blue focus ring
- **Animations:** subtle fade-in on scroll, no heavy parallax or motion
- **Icons:** Lucide or Heroicons — outline style, consistent 24px grid

---

## Homepage Page Structure

| # | Section | Background |
|---|---|---|
| 1 | Sticky navigation | White |
| 2 | Hero — bold headline + 2 CTAs | Dark navy |
| 3 | Trust strip — key stats or logos | Light slate |
| 4 | Problem statement | White |
| 5 | Features grid — 3-col cards | Light slate |
| 6 | How it works — numbered steps | White |
| 7 | Testimonials / social proof | Light slate |
| 8 | Pricing teaser or mid-page CTA | Dark navy band |
| 9 | Services section — 2-col layout | White |
| 10 | Final CTA — "Ready to validate your next study?" | Dark navy |
| 11 | Footer | Dark navy |

---

## What to Avoid

- Pastel colors, organic shapes, or "wellness" aesthetics
- Cartoon or emoji-heavy iconography
- Dense text walls without visual hierarchy
- Auto-playing video backgrounds
- Overuse of gradients or glassmorphism effects
- Generic stock photos of people in lab coats
- Cluttered navigation with too many items
- Any design that looks "startup cute" rather than "clinical professional"

---

## Sample Prompt for Claude

Copy and paste this when asking Claude to generate any page or component:

```
Design a [page/component] for Clindar.eu — a CDISC validation tool for small CROs 
and biotech companies. Use the Clindar design brief:

- Dark navy hero (#0B1F3A), white/light slate (#F4F6FA) alternating sections
- Inter font, electric blue (#1D72E8) CTAs, near-black (#111827) body text
- Clean, high-contrast, professional — inspired by Veeva, Medidata, and Appsilon
- No stock photos, no gradients, no rounded-corner excess
- Subtle 1px borders on cards, outline-style Lucide icons
- Max content width 1200px, generous vertical whitespace

Include: [describe what you need, e.g. sticky nav, hero with headline + 2 CTAs, 
3-col feature cards, stats strip, and dark footer]
```
