# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: solo web freelancers and micro-agencies in the German-speaking
countries (CH, DE, AT) who sell websites to local hospitality businesses —
restaurants, cafés, bars, takeaways. Situation: they prospect on their own,
between client work, mostly from a laptop, and reach owners through WhatsApp,
Instagram DM, a phone call or by walking in. Job: find businesses worth
approaching, know why each one is worth it, convince the owner, and follow up
until the deal closes or dies.

Today the only user is Kevin (Serviweb, Wil SG), who built the tool for his
own prospecting. The landing page's visitor is the freelancer described
above; the first action the page asks of them is joining the waitlist. A
prepaid early-access offer is the secondary, stronger signal.

## Product Purpose

Client-Map finds every hospitality business in a chosen map area, scores how
much each one needs a website, builds a demo site for a specific business to
show its owner, and tracks contacts and follow-ups per business. It exists
because the hard part of selling websites to local businesses is not the
list — it is knowing who really needs one, convincing the owner, and
following up. Success for the page: waitlist signups and prepayments
(validation phase, Sept 2026); success for the product: signed website jobs
for the freelancer.

## Positioning

Every competitor in this market (Webleadr, Huntly, No-Site Search, Crective,
FindLeadly, LeadWebia) sells a list of businesses without a website. Client-Map
is the only flow that joins discovery, scoring with visible reasoning, a
generated demo site as the sales argument, and follow-up tracking in one
tool — and the only one built for DACH: German UI, Swiss/German categories,
WhatsApp and Instagram outreach instead of cold email.

A mechanism no neighbour can truthfully copy: "unverified stays visibly
unverified". A missing website entry in OpenStreetMap is not proof of no
website; the map shows a dashed ring until an analysis has actually looked,
so the freelancer never pitches a business that already has a good site.

## Operating Context

- Data comes from OpenStreetMap (Overpass, Nominatim), optionally enriched
  via Google Places. The business's own website and Instagram are what get
  checked — never review portals.
- Three speeds of checking: a free HTTP web-check (~2 s), a quick agent check
  (~30 s), a deep analysis (2–3 min) written as Markdown.
- Two independent dimensions on every pin: colour = pipeline status (new,
  researched, interested, demo built, contacted, in conversation, customer,
  paused, declined, site already good, no fit, closed); ring = lead score
  (cold / interesting / hot 70+), dashed = unverified.
- Scoring is explicit and visible: no website +40, broken/no SSL/not mobile
  +30, outdated +20, unknown +20 provisional, modern −10; Instagram active
  +25, inactive +15; reviews ≥50 and ≥4.0 +15, under 10 −10; phone or mail
  +5; chain −20.
- Contact history per business (channel, outcome, note); status moves
  forward automatically, never backwards. One follow-up date per business.
- The funnel counts cumulatively ("reached this stage at least").
- Demo sites are built by an agent in an isolated folder; outreach drafts are
  generated for Instagram DM and email — the app never sends anything.
- Local single-user app (SQLite, no cloud, no accounts) — today.

## Capabilities and Constraints

Confirmed capabilities: map discovery with clustering and saved filters,
scoring with visible breakdown, quick/deep analysis, demo generation,
outreach drafts, contact history, follow-up dates, funnel, CSV export,
duplicate detection, backups, region scans.

Constraints for the landing page:
- Only anonymised screenshots of the real app may appear; venue names,
  phone numbers, addresses and handles on the page are fictional. Never a real
  business next to "website broken".
- No invented testimonials, customer counts, benchmarks or endpoints. The
  product has one user; multi-user, accounts and billing do not exist yet.
- Planned pricing from the validation plan: Free (25 leads/month), Solo 29 €,
  Pro 79 € (demo generator is the paywall), Agency 199 €; early access
  19 €/month locked. These are planned, not bookable; the page must say so.
- German-speaking audience; the page is German first with an English version.
- Waitlist and prepayment are external links (form + Stripe) the owner sets.
- Static HTML, no build step, self-hosted at clientmap.serviweb.ch.

Undecided: exact launch timing; whether Gastro stays the only vertical.

## Brand Commitments

Product name "Client-Map"; maker "Serviweb" (Kevin Schmid, Wil SG). No other
brand asset is binding; the visual world of the landing page is open and the
previous page's look is not a constraint.

## Evidence on Hand

- Anonymised screenshots of the running app at 2×, WebP, in
  `landing/screenshots/`: Berlin at city zoom with clusters (`karte-region`,
  plus a cropped `hero` variant), Berlin-Neukölln at street level with an open
  business (`karte-detail`), list with funnel (`liste`), list with a 45-point
  business open (`liste-detail`), detail panel top and bottom (`detail-kopf`,
  `detail-aktionen`). Real numbers in them: 4 335 businesses on file of which
  2 617 are in Berlin, funnel 36 → 4 → 4 → 3 → 2 → 2 → 2, 2 customers,
  3 demos built. The Berlin records are all status `neu`; the pipeline
  progress in the list screenshots comes from the Wil SG records, so a
  Berlin-filtered funnel would be empty and must not be captioned as Berlin.
- Market research in the validation plan (competitor table, gaps): Webleadr sells
  100 credits for $12, i.e. a list of businesses without a website at roughly
  twelve dollars per hundred; Huntly, No-Site Search, Crective, FindLeadly,
  LeadWebia stop at discovery. This is the source for any "twelve dollars" line.
- Early-access terms confirmed in the validation plan: 19 EUR/month locked
  forever for prepayers. No refund policy has been decided; the page must not
  promise one.
- No testimonials, no customers besides the maker, no usage statistics beyond
  the maker's own database.

## Product Principles

1. Prove with the running tool, never with claims: the screenshots and the
   scoring rules are the argument.
2. Unverified is shown as unverified; the product never guesses on the
   freelancer's behalf and the page must not either.
3. The demo site is the pitch; words are secondary.
4. Follow-up is a first-class object, not a note.
5. Honesty about the product's stage is part of the offer: the page decides
   whether this becomes a product.
