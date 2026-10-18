---
name: Support Desk
description: Neutral, task-first support interface with restrained gold actions.
colors:
  paper: '#f3f3f4'
  card: '#ffffff'
  ink: '#111111'
  ink-soft: '#3a3a3a'
  ink-faint: '#666670'
  line: '#e0e0e3'
  line-soft: '#ececee'
  hover: '#f6f6f7'
  accent: '#8a6820'
  accent-ink: '#ffffff'
  accent-soft: '#f6f0e4'
  accent-line: '#d8c8a6'
  action-bg: '#ad8326'
  action-ink: '#111111'
  action-hover: '#c49a3d'
  thread-canvas: '#eaeaec'
  thread-line: '#d4d4d8'
  ok: '#24704a'
  ok-soft: '#e8f4ec'
  ok-line: '#cde6d6'
  warn: '#8a5d0f'
  warn-soft: '#fbf3df'
  warn-line: '#f0e0ba'
  err: '#8a2b2b'
  err-soft: '#fdecec'
  err-line: '#f3c9c9'
  info: '#555555'
  info-soft: '#eeeeee'
  info-line: '#cccccc'
  dark-paper: '#141415'
  dark-card: '#1c1c1e'
  dark-ink: '#f0f0f2'
  dark-ink-soft: '#c9c9ce'
  dark-ink-faint: '#9a9aa2'
  dark-line: '#2e2e32'
  dark-line-soft: '#252528'
  dark-hover: '#232326'
  dark-accent: '#e8dbbe'
  dark-accent-ink: '#171717'
  dark-accent-soft: '#302a1f'
  dark-accent-line: '#5c4b2b'
  dark-action-bg: '#ad8326'
  dark-action-ink: '#141415'
  dark-action-hover: '#c49a3d'
  dark-thread-canvas: '#18181a'
  dark-thread-line: '#36363b'
  dark-ok: '#7cc29a'
  dark-ok-soft: '#1e2c24'
  dark-ok-line: '#2c4636'
  dark-warn: '#d9a44a'
  dark-warn-soft: '#322a18'
  dark-warn-line: '#4a3d20'
  dark-err: '#e08585'
  dark-err-soft: '#331e1e'
  dark-err-line: '#4a2b2b'
  dark-info: '#cccccc'
  dark-info-soft: '#292929'
  dark-info-line: '#444444'
typography:
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '28px'
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: '-0.01em'
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '19px'
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: '-0.01em'
  subtitle:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '16px'
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: '-0.01em'
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '14px'
    fontWeight: 600
  hint:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.6
rounded:
  surface: '3px'
  count: '10px'
  avatar: '50%'
spacing:
  compact: '8px'
  control-gap: '10px'
  stack: '12px'
  mobile-inset: '16px'
  surface-inset: '20px'
  desktop-gutter: '40px'
components:
  button-primary:
    backgroundColor: '{colors.action-bg}'
    textColor: '{colors.action-ink}'
    rounded: '{rounded.surface}'
    padding: '10px 18px'
  button-primary-hover:
    backgroundColor: '{colors.action-hover}'
    textColor: '{colors.action-ink}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    rounded: '{rounded.surface}'
    padding: '10px 18px'
  input:
    backgroundColor: '{colors.card}'
    textColor: '{colors.ink}'
    rounded: '{rounded.surface}'
    padding: '10px 12px'
  navigation:
    textColor: '{colors.ink-soft}'
    rounded: '{rounded.surface}'
    padding: '0 10px'
  status-open:
    backgroundColor: '{colors.accent-soft}'
    textColor: '{colors.accent}'
    rounded: '{rounded.surface}'
    padding: '3px 10px'
  card:
    backgroundColor: '{colors.card}'
    rounded: '{rounded.surface}'
    padding: '20px'
  owner-message:
    backgroundColor: '{colors.accent-soft}'
    rounded: '{rounded.surface}'
    padding: '14px 18px 16px'
  dropzone:
    backgroundColor: '{colors.card}'
    textColor: '{colors.ink-soft}'
    rounded: '{rounded.surface}'
    padding: '18px'
  file-remove:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-soft}'
    height: '44px'
    width: '44px'
  request-row:
    padding: '16px 18px'
---

# Design System: Support Desk

## Overview

**Creative North Star: "The Working Desk"**

A compact working desk built from neutral surfaces, clear type and restrained gold. Borders and tonal changes separate requests, conversations and controls without decorative depth.

Light and dark themes retain the same hierarchy and geometry. The interface preserves the incumbent Operate layout and system typography; it introduces no separate display identity.

**Key Characteristics:**

- Neutral surfaces with gold actions and theme-aware accents.
- Compact hierarchy, visible focus and 44px principal controls.
- Flat bordered containers with 3px corners.
- Responsive request rows and aligned conversation messages.

## Colors

Gold distinguishes actions and selected states within a black, white and gray foundation.

### Primary

Action gold fills primary buttons with dark ink labels in both themes. The brighter hover token provides feedback. The darker light-theme accent supports text, focus, active navigation and counters; pale gold takes that role in dark mode.

### Neutral

Paper is the page canvas; card is the raised-tone surface. Ink, soft ink and faint ink distinguish primary content, supporting content and metadata. Line and soft line separate containers and rows. Thread canvas and thread line distinguish the conversation from its messages.

### Semantic

Green denotes completed or successful states, amber waiting or warning states, red urgent or failed states, and gray new or informational states. Each has text, background and border tokens in both themes. Status text carries meaning alongside color.

**The Theme Pair Rule.** Switch the complete token set with the root theme attribute; preserve each token's role across themes. Frontmatter components describe the light defaults; runtime CSS variables supply their dark counterparts.

## Typography

System typography supplies application headings, body copy and controls. There is no independent display face or promotional type treatment.

Headline, title and subtitle tokens map to the three heading levels. Body supports forms and request text; conversation text uses a slightly looser line height (1.65). Labels are compact and semibold; hints and metadata are quieter. Status labels use uppercase and modest tracking (0.03em). Counts and request references use tabular numerals.

## Layout

The standard content column is 880px and the owner workspace is 1180px, each with 40px outer gutters. Gutters reduce to 20px below 720px. Page top spacing moves from 32px to 24px at that breakpoint; bottom spacing remains 72px.

Cards and conversations use 20px insets, reducing to 16px below 620px. Request rows wrap metadata below the main text at that breakpoint. Type choices become two columns from 640px. Owner detail uses a flexible conversation column and a 320px sidebar from 980px; narrower layouts stack them. Grid children permit shrinking so long content cannot widen the page.

Conversation messages occupy at most the smaller of 86% and 760px. The viewer's messages align right. Below 620px, messages leave 16px of alignment space, and message metadata wraps beneath the author. These limits describe the existing conversation, not a universal prose width.

Actions wrap and share available width below 560px. Header labels compact below 560px, and the header itself wraps below 400px. Mobile tables become stacked rows below 720px.

## Elevation & Depth

Surfaces are flat. Borders and background tones provide separation; there are no ambient or offset shadows. The only box shadows mark active navigation with an inset underline and selected request types with a one-pixel ring. No transitions or decorative animation are declared.

**The Flat Surface Rule.** Use borders and tonal contrast for structure; reserve the existing shadow forms for selection indicators.

## Shapes

The surface radius governs buttons, fields, cards, status labels and messages. Circular author avatars and rounded numeric counters are the established exceptions. Dashed borders identify private notes, file drop areas and earlier-message disclosures.

## Components

### Buttons

Gold fills primary actions; secondary actions use transparent surfaces and neutral borders. Hover changes the fill or border without movement. Disabled buttons use line and soft-ink tokens. Buttons have a minimum height of 44px; icon controls have a 44px square target.

### Inputs / Fields

Fields use card surfaces, line borders and full available width, with 44px minimum height. Textareas resize vertically and normally start at 140px. Labels stay visible above fields. Focus changes the border and adds a two-pixel accent outline; field errors appear in semantic error text.

### Navigation

Header links use compact labels, neutral hover fills and 44px targets. Current-page links and selected queue tabs receive an inset accent underline. Root theme selection is applied before first paint, using the saved preference or the device preference.

### Status labels

Small bordered labels combine uppercase text with semantic colors. Delivery tags use sentence-case text and the same semantic color families. Numeric queue counts remain visually distinct from status labels.

### Cards / Containers

Cards use flat card-colored backgrounds, line borders and shared surface corners. Request rows form one divided container, with a neutral hover fill and a separate metadata group.

### Conversation and composer

Messages sit inside a darker neutral conversation canvas. Owner messages use soft accent fills; private notes use transparent fills and dashed borders. The composer shares the canvas color. Draft and send controls retain distinct text labels. Attachment links include inline SVG and a 44px minimum height.

### File picker

A dashed drop area changes border and background on hover or drag and shows a focus outline when its file input has focus. File rows show the filename, size and a labeled remove button with an inline SVG cross.

## Do's and Don'ts

### Do:

- Do use theme tokens for surfaces, text, borders and semantic status.
- Do retain ink labels on gold primary actions.
- Do keep visible focus and 44px targets for buttons, navigation and disclosure controls.
- Do pair status color with a readable text label.
- Do use inline SVG for control icons.

### Don't:

- Don't introduce decorative shadows or animation.
- Don't replace the approved neutral and gold palette with a new visual identity.
- Don't turn private-note styling into ordinary client-message styling.
