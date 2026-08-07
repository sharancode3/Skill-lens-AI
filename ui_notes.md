# UI Application Notes — Flat Design System applied to the Interview Agent

The full design-system spec (colors, typography, component stylings, motion) was provided separately and must be followed **verbatim, with zero deviation, across every screen**. This doc only maps that system onto this specific app's three screens. Do not re-derive tokens — copy them exactly from the design-system prompt (Primary `#3B82F6`, Secondary `#10B981`, Accent `#F59E0B`, Muted `#F3F4F6`, font `Outfit`, radius `rounded-md/lg`, zero shadows, hover-scale interactions).

---

## Screen 1 — Candidate / Session Start
- Full-bleed **Primary blue** hero block (per "Vibrant full-section color blocks" bold-factor rule) with large decorative low-opacity geometric shapes (rotated square + circle) in the background, per the decoration rules.
- White heading ("Ready for your interview?"), Outfit Extra Bold, tight tracking.
- Candidate name/role card below in a white **Color Block card** (no shadow, `rounded-lg`, `p-8`) showing `jobRole`, `yearsExperience`, and a small stat row (missions completed, first-try rate) using **multi-color stat numbers** — one accent color per stat, per the Bold Factor rules.
- Primary button ("Start Interview") — solid Primary, `h-14`, `hover:scale-105`, white text, no shadow.

---

## Screen 2 — Chat Interview
- Header bar: Muted (`#F3F4F6`) background, candidate name + a slim progress indicator (`questionsAsked / 8` and `distinctDaysCovered.length / 4`) rendered as small solid color-block pills, not a shadowed progress bar.
- Message list:
  - Interviewer messages: left-aligned, `bg-white` bubble inside the Muted page background, `rounded-lg`, no border, no shadow — separation comes purely from background color contrast (page is Muted, bubble is White).
  - Candidate messages: right-aligned, Primary-tinted bubble (`bg-blue-50` per the Cards "soft color tint" rule), Foreground text.
  - No timestamps clutter — keep it lean, one detail per line.
- Typing/thinking state: instead of a spinner-with-shadow, use a simple 3-dot pulse in Primary color — flat, no blur.
- Input area: sticky bottom, `bg-gray-100` input (per Input spec), `border-2 border-primary` only on focus, Primary "Send" button (icon-only, `lucide-react` `Send` icon inside a `bg-primary` circle, `hover:scale-105`).
- Topic transition moments (when `action: advance`) can get a subtle **Secondary (Emerald) accent tag** ("New topic") — small `rounded-md` label, uppercase, `tracking-wider`, per Labels/Buttons typography rule — this gives the judge a visible adaptivity cue without breaking flat aesthetic.

---

## Screen 3 — Feedback Report
This is the payoff screen — treat it like the "poster" sections described in the Bold Factor rules:
- **Summary** section: full-width Primary blue color block, white bold heading, `summary` text in white/95, generous `p-8`.
- **Strengths**: Secondary (Emerald) tinted section (`bg-green-50` cards inside a white page section, or a full Emerald block per "alternating backgrounds" rule) — each strength as its own Color Block card with a `CheckCircle` lucide icon inside a white circle (`bg-white text-emerald-600`, `h-14 w-14`), per Iconography spec.
- **Gaps**: Amber-accented section, same card treatment, `AlertTriangle` icon, `bg-white text-amber-600` circle.
- **Next steps**: Muted/dark section (per "Dark gray How It Works & Footer" pattern) with a numbered list styled as bold Outfit numerals (large, colored, flat — no badges/shadows), each tied to a specific day like the algorithm requires (TRD §3.5).
- Bottom CTA: Outline button ("Download / Restart"), `border-4`, fill-on-hover per Outline button spec.

---

## Non-negotiable checklist before calling any screen "done"
- [ ] Zero `box-shadow` anywhere except accessibility focus rings
- [ ] Zero gradients on interactive elements (background decoration gradients only)
- [ ] All hover states use scale + color shift, not shadow depth
- [ ] Outfit font loaded and applied to all text (Bold/Extra Bold headings, Regular body)
- [ ] Every section uses a deliberate flat color block (White / Muted / Primary / Secondary / Accent) — no default gray-on-gray monotony
- [ ] Icons are `lucide-react`, 2–2.5px stroke, inside solid color circles where used decoratively
- [ ] Focus states use `ring-2 ring-offset-2 ring-blue-500` (since shadows are banned, this is the only accessible focus affordance)
