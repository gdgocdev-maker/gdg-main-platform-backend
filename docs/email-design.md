# Authentication email design

## Brand study and decisions

Sources: frontend `TYPOGRAPHY.md`, `app/globals.css`, `components/Footer.tsx`,
`public/images/black-logo-with-colors.png`, `lib/constants/social-links.ts`,
and `messages/{ar,en}/{home,common,dashboard}.json` (local frontend head d2bf9bc).
The platform pairs a neutral canvas and rounded cards with restrained Google-color
accents. Its English invitation is “Connect. Learn. Build. Grow.”; Arabic emphasizes
learning, collaboration, and making an impact. Email keeps that warmth while making
account actions explicit. No animations, hero photography, or unrelated Google G.

Google's [community page](https://developers.google.com/community) names the program
Google Developer Groups on Campus. The old public brand-guidelines URL redirects
there; this is not a claim of a fresh official brand approval. Preserve the supplied
chapter lockup, its proportions, English wordmark, and four-color mark. Do not mirror,
redraw, recolor, crop, or detach its university name. Use a white logo panel even in
dark mode. Reserve at least 24px clear space around the image (a conservative email
layout decision, not a quoted Google measurement). Use the provided lockup rather
than re-typesetting Google branding.

The live `gdguj.org` domain did not resolve during review. Once the frontend branch
was published, its exact PNG became publicly available (verified HTTP 200 image/png).
Final templates use the immutable published frontend asset:

https://raw.githubusercontent.com/gdgocdev-maker/gdg-main-platform-frontend/d2bf9bc57d98caa73356c7405eab1710de08da90/public/images/black-logo-with-colors.png

No base64, SVG, private URL, or remote font dependency is embedded. The render
harness fetches and validates this hosted PNG once, then serves the returned bytes
from cache to each screenshot. An explicit `EMAIL_LOGO_FIXTURE` enables offline
fixture rendering and is recorded as a substitution. Restore website DNS for live
account-action links before deployment. The six earlier live samples used the
original production-domain logo URL; receipts record that URL. They were not resent.

## Palette and type

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | #f1f3f4 | #171717 |
| Card / ink | #ffffff / #202124 | #202124 / #f1f3f4 |
| Secondary text | #5f6368 | #c4c7c5 |
| Callout / footer | #f1f3f4 / #f8f9fa | #292a2d |
| Link | #1967d2 | #a8c7fa |
| CTA / label | #1967d2 / #ffffff | same |
| Decorative accents | #4285f4, #34a853, #f9ab00, #ea4335 | same |

The frontend's #f9ab00 yellow is used in the accent rail; #fbbc04 is another existing
Google yellow token, not a new email color. Primary colors decorate, never carry
small body text. Darker blue is used for accessible controls. All text pairs exceed
4.5:1, including white on CTA blue; decorative rails are not semantic indicators.

English: `Inter, Arial, Helvetica, sans-serif`. Arabic: `'IBM Plex Sans Arabic',
Tahoma, Arial, sans-serif`. Fonts use the intended brand face when already installed;
email does not depend on downloadable fonts. Headline 28px/1.4, body and CTA 16px/1.8
(CTA line-height 24px), supporting text and footer 14px/1.8, OTP 28px monospace.
Keep the same scale across locales, and use Arabic line spacing without tracking.

## Grid and shared components

- One 600px maximum table, 32px desktop canvas margin, 32px content gutters.
  At <=620px: 12px canvas gutters and 24px content gutters, full-width CTA.
- Header: untouched 280×45-proportion PNG within a white panel; chapter identity
  remains LTR in both locales. Four solid table cells form a 4px decorative rail
  (blue, green, yellow, red), replacing gradients for Outlook reliability.
- Hero: a 14px contextual label, one 28px headline, one concise 16px paragraph.
  Each message has exactly one primary action, with an underlined fallback URL.
- CTA: 52px minimum height, 10px radius HTML link and Outlook VML roundrect,
  280px VML width with enough space for Arabic labels. No image-based text.
- Optional OTP: labelled neutral table callout; isolated LTR digits, centered,
  escaped. Current production flow uses links, so previews do not invent an OTP.
- Info/security callout: neutral surface, 3px leading-edge accent; red for the
  password-change notice. Explicit instructions, no color-only meaning.
- Footer: chapter name; University of Jeddah, Jeddah, Saudi Arabia (no fabricated
  street address); official LinkedIn/X URLs; per-message reason for receiving it;
  automated sender note. Support goes to the frontend's official LinkedIn account,
  not an invented support mailbox or the no-reply sender. No marketing unsubscribe
  on mandatory authentication messages.

Arabic uses `lang=ar`, `dir=rtl`, right alignment and a right-side callout border.
English is LTR. URLs, OTPs, wordmark and Latin chapter identity retain LTR direction.
Native Arabic invitations are short and inclusive; account instructions use direct,
clear standard Arabic, without literal English slogans. Security copy stays calm.
Welcome explicitly distinguishes verified email from approved membership.

## Lifecycle and engineering

The existing string renderer remains dependency-free, composed from shared table,
paragraph, button, code, callout, header and footer pieces. Every template returns a
subject, hidden preheader, HTML, and complete text alternative. URL protocols are
validated and untrusted codes/URLs escaped. No personal data is added to subject lines.

Verification, reset and email-change confirmations expire in 3600 seconds, matching
explicit Better Auth settings. Welcome and password-changed buttons are ordinary
site links; their copy explicitly says they do not expire. The welcome action uses
the existing locale-specific sign-in destination. Password-changed mail is sent by
Better Auth's successful password-reset hook only, not by ordinary authenticated
password changes. Delivery failure there cannot undo the completed password reset;
notification is best-effort, with no retry queue added in this design change.

Inline critical styles, table layout, fixed-width MSO wrapper, VML, 96 DPI Office
setting, semantic headings, descriptive alt, 14px minimum copy, and no gradients,
flexbox, webfonts, or background-image dependency. A dark media query enhances
Apple Mail and compatible clients. Clients that strip media queries keep the light
inline presentation. Forced inversion in Gmail/Outlook is client-controlled and
needs a real inbox review; browser renders cannot certify those engines.

## Validation artifacts

Run build first, then `node scripts/render-auth-emails.mjs`. Install Playwright in
an external tooling directory and set `PLAYWRIGHT_MODULE` to its index.mjs if it is
not available in this repository. The renderer validates and caches the hosted PNG (or an explicit offline
`EMAIL_LOGO_FIXTURE`), records the source in `manifest.json`, and generates
40 full-page PNGs: five templates × two locales × desktop/mobile × light/dark.
It also writes ten HTML and ten text fixtures. Widths: 800 and 390 CSS px; DPR 1.
It checks asset decode, horizontal overflow, 600px card bound, CTA visibility and
computed text contrast, plus HTML size below 100KB. Screenshots are Chromium visual
checks, not a substitute for Outlook/Gmail/Apple Mail inbox testing.

The owner-authorized sample sender is `node scripts/send-auth-email-samples.mjs`.
It is restricted to abdullahwalid18@gmail.com and noreply@gdguj.org, reads ignored
.env without printing credentials, uses stable provider idempotency keys and a
persistent local reservation/receipt journal, and sends only five EN samples plus
AR verification. Preview links are harmless example URLs with no real auth tokens.

Final verification: 40/40 renders passed, minimum computed contrast 5.09:1 and largest
HTML 8,611 bytes. The samples were accepted by Resend; message IDs are recorded in
`artifacts/auth-emails/v2/resend-receipts.json`. Backend lint, typecheck, 271 Vitest
and 15 Node tests, and build passed. Frontend typecheck, three routing tests and
webpack production build passed; full lint still has six existing errors and 15
warnings. Native mail-client rendering remains unverified; the final hosted logo is HTTP-checked.
