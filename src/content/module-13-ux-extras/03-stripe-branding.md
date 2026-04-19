---
title: '13.3 - Stripe Branding'
module: 13
lesson: 3
moduleSlug: 'module-13-ux-extras'
lessonSlug: '03-stripe-branding'
description: "Brand your Stripe checkout and customer portal to match Contactly's design."
duration: 8
preview: false
---

## Overview

In Module 8 we wired up Stripe Checkout. It works — the user clicks "Upgrade," lands on a Stripe-hosted page, enters a card, and returns to Contactly as a Pro subscriber. But that hosted page is ugly. It says "Stripe" at the top. It has no color. Your logo is nowhere to be found. For a user mid-purchase, the jump from "Contactly" to "unbranded corporate checkout" is jarring — and measurably tanks conversion.

Stripe knows this. That's why they ship a **branding panel** in the Dashboard that lets you upload a logo, set a brand color, and have those choices automatically apply to every hosted surface: Checkout, Customer Portal, Invoices, emails. Zero code. A one-hour configuration pass that pays dividends on every future purchase.

This lesson walks through the setup, explains what each setting controls, shows how to test the branded experience, and grounds the work in the data on why brand consistency at the checkout moment is worth the effort.

## Prerequisites

- Module 8 complete — Stripe Checkout is live, you have a test-mode account, and at least one Price configured.
- Contactly has a logo file (even a rough version). You'll need it as a 512×512 PNG.
- Access to the Stripe Dashboard for the account you're using.

## What You'll Build

- A fully branded Stripe Checkout session with your logo, primary color, and accent color.
- A fully branded Stripe Customer Portal for subscription management.
- A branded icon (favicon-size) for mobile-friendly displays.
- Verification that your test-mode checkout renders the brand before you roll to production.

---

## Why Brand Consistency Matters at Checkout

Before we touch the Dashboard, a quick argument for why this work justifies the hour.

Cart abandonment data across thousands of SaaS businesses consistently shows that **trust signals at the payment step** are among the top three levers of conversion. "Trust signal" is a catch-all for anything that reassures the user: HTTPS padlock, familiar payment logos (Visa/MC), consistent visual identity between the app and the checkout, clear pricing with no surprises.

A typical Stripe default checkout has the HTTPS signal and the payment logos, but it's visually discontinuous from your product. Users experience the transition as "I was on Contactly, now I'm on… some other site." Even if it's subconscious, it shaves off a couple percent of conversion. For a SaaS at even modest scale (1000 attempts/month, $29 MRR each), a 2% conversion lift is $7k in annualized revenue from an hour of configuration.

Separately, branded checkouts reduce support tickets. "I paid but Contactly says I'm not a subscriber" is twice as common when the checkout page says Stripe. Users don't associate their receipt with your product. Your logo in the receipt email fixes that.

So: one hour, measurable revenue lift, fewer support tickets. Let's configure it.

---

## Step 1: Access the Branding Panel

Open the Stripe Dashboard. Top-right, make sure you're in **Test mode** (the toggle is next to your account name). All the changes we make are scoped per-mode; you'll configure test first, verify, then repeat in live mode.

Navigate: **Settings** (gear icon, bottom-left) → **Business → Branding**.

You'll land on a panel with four sections:

1. **Icon** — a small square that appears in invoices and emails at smaller sizes.
2. **Logo** — the main logo for Checkout headers and Customer Portal.
3. **Brand color** — the primary accent color for interactive elements (buttons, links).
4. **Accent color** — a complementary color for hover states and subtle highlights.

---

## Step 2: Upload the Logo

### Prepare the file

Stripe's logo field wants a **PNG at 512×512 pixels**. A few specifics:

- **Format: PNG** (or JPG). SVG isn't accepted — Stripe rasterizes internally so they control the final output.
- **Size: 512×512** minimum. You can upload larger and Stripe resizes; don't upload smaller because the result looks blurry on retina screens.
- **Transparent background preferred.** Stripe applies a white background on most surfaces, but the Customer Portal has a light-gray section where a non-transparent white rectangle would show a visible seam.
- **Centered artwork with padding.** The logo fills the 512×512 canvas; put your mark centered with ~15% padding on all sides. Edge-to-edge logos get cropped on some hosted surfaces.

If your only logo file is a horizontal wordmark, make a square version: put the wordmark on a single line centered in a 512×512 canvas, or use just the icon/mark portion. Square logos look better in Stripe's UI and in email clients.

### Upload

Click the Logo section's upload button, select your file, click Save. Stripe shows an instant preview. If the preview looks cramped, your source file needs more padding.

---

## Step 3: Upload the Icon

The Icon appears at smaller sizes — invoice PDFs, email thumbnails, mobile browser tabs for the hosted pages. Stripe wants a **128×128 PNG**.

This one is **not** just a resized logo. At 128px, wordmarks are illegible. Use your icon/mark (the non-text component). If Contactly's logo is "a little address-book icon next to the word Contactly," the icon upload should be just the address-book icon.

If you don't have an icon-only mark, generate one:

- Take the first letter of the product name (C for Contactly) in your brand color on a white (or transparent) background.
- Or use the initial inside a colored circle for a bolder look.

Upload. Save.

---

## Step 4: Pick the Brand Color

Under **Brand color**, enter your hex code. For Contactly, assume it's `#3B82F6` (Tailwind's `blue-500`). Stripe applies this to:

- Primary CTA button backgrounds (the "Subscribe" button on Checkout).
- Interactive link colors.
- Selected-state highlights (radio-button fills, chosen-plan borders).

**Picking the right value:**

- **Match your app's primary.** Whatever color the "Save" button is in Contactly — use that exact hex. Users should perceive the checkout as a continuation of Contactly, not a separate site styled similarly.
- **Contrast with white.** Stripe uses white backgrounds on the Checkout page. Your brand color will be button fills, so it needs to be readable when white text sits on top. A WCAG AA check (4.5:1 contrast) is the floor. Tools like `colorable.jxnblk.com` verify instantly.
- **Avoid low-saturation greys.** They look like "disabled" on buttons. Saturated colors read as interactive.

Save.

---

## Step 5: Pick the Accent Color

Accent color is subtler — Stripe uses it for hover states, subtle borders, and secondary highlights. It should be **complementary** to the brand color without clashing.

Safe default: use a darker variant of your brand color. If brand is `#3B82F6` (blue-500), accent is `#2563EB` (blue-600). This creates a clean primary/secondary pair that reinforces your palette.

If you want more distinction, pick a neutral that sits between "dark grey" and "near-black" — `#1F2937` works well with most bright brand colors. Avoid picking a second fully-saturated color (like orange alongside blue) unless your brand uses both — mixing colors on a checkout page reads as chaotic.

Save.

---

## Step 6: How Branding Applies Across Stripe Surfaces

You configured the brand once. Here's where it shows up, automatically, with no additional code:

### Stripe Checkout (hosted mode)

When your app creates a Checkout session via the API, the returned `session.url` is a branded page with:

- Your logo at the top of the panel.
- Your brand color on the primary "Pay" / "Subscribe" button.
- Your accent color on focus-rings and input-field borders.
- Your icon in the browser tab.

No code changes needed — Stripe reads the branding from your account settings every time a session is rendered.

### Customer Portal

The Customer Portal (the page users land on from the "Manage subscription" button) inherits the same branding. Logo, colors, icons.

The portal additionally lets you customize:

- **Which features are enabled** — can users cancel? Switch plans? Update payment method? (Set in Settings → Billing → Customer Portal.)
- **The "Back to Contactly" URL** — so users can return to your app from the portal with one click.

Make sure you've set the return URL in Test mode. It should be your test-mode app URL (`http://localhost:5173` or your preview deploy).

### Invoices and email receipts

Every invoice PDF and every email receipt uses your logo and brand color. No configuration needed — the same assets drive everything. A user who pays $29 gets an email receipt later that day with Contactly's logo, not a raw Stripe template. Trust signal.

### Hosted invoice pages

If you ever send an invoice to a customer and they view it via the link Stripe provides, that page is also branded. Relevant for B2B billing or add-hoc charges.

---

## Step 7: Test the Branded Checkout

Fire up the app.

```bash
pnpm dev
```

Navigate to your pricing page. Click **Upgrade to Pro** to create a Checkout session. You should be redirected to a page with:

1. Your logo at the top.
2. "Pay Contactly" (or whatever your business name is) in the header.
3. A **Subscribe** button in your brand color.
4. Your icon in the browser tab.

Screenshot it. Compare to the stock Stripe checkout (if you still have a screenshot from Module 8). The difference is dramatic.

Go through a test purchase using Stripe's test card `4242 4242 4242 4242`. Complete the flow. You return to Contactly.

Check your email (or Stripe → Events → the resulting `charge.succeeded`). The receipt should also be branded — logo at the top, brand color on the total, your return URL in the footer.

Then exercise the Customer Portal:

1. On the dashboard, click **Manage subscription**.
2. Stripe redirects to the portal.
3. The portal header shows your logo.
4. Buttons ("Cancel subscription," "Update payment method") are in your brand color.
5. "Return to Contactly" sends you back to your app.

If anything looks off — logo cropped, colors jarring, icon missing — go back to the branding panel and adjust.

---

## Step 8: Roll to Live Mode

Stripe's Test and Live modes have **separate** branding settings. You can configure Test first, validate, then port to Live with confidence that you're not pushing half-baked assets to real customers.

1. Top-right, switch to **Live mode**.
2. Settings → Business → Branding.
3. Upload the same logo, icon, colors.
4. Save.

Your next real-customer checkout session will be branded. No deployment needed; no code change; the effect is instant.

---

## Common Mistakes

- **Uploading a 100×100 logo and hoping it scales.** Stripe renders at 1x and 2x on retina; small source assets blur. Always 512×512 minimum.
- **Using a wordmark as the icon.** At 128×128 the text becomes unreadable. Use just the mark/symbol.
- **Picking a low-contrast brand color.** A pale yellow on white makes the "Subscribe" button invisible. Run every brand color through a contrast checker.
- **Forgetting to set branding in Live mode.** Test and Live are separate. You'll launch and wonder why real customers are getting unbranded checkouts.
- **Configuring the Customer Portal without a return URL.** Users cancel, Stripe shows a "done" page, and they're stranded with no way back to your app. Set the return URL under Settings → Billing → Customer Portal.
- **Uploading a horizontal logo as-is.** It gets cropped or becomes a tiny strip in the header. Make a square version — the 15 minutes in design tooling is worth it.

---

## Principal Engineer Notes

1. **Trust signals compound.** Branding at checkout is one signal. Pair it with: a clear product name in the charge statement descriptor (set under Settings → Public business info so users see "CONTACTLY.APP" on their credit card statement, not "STRIPE CHECKOUT 123"), a recognizable sender address on receipt emails, and a professional-looking receipt PDF. Every one of these reduces "What's this charge?" refund requests and support tickets. The aggregate lift is larger than any single signal.

2. **Branded Checkout vs custom domain is a deliberate stopping point.** Stripe supports setting a custom domain for your hosted Checkout (`checkout.contactly.app` instead of `checkout.stripe.com`) on higher-tier accounts. That's the next level of visual integration. It's worth it once you're past ~$10k MRR; before that, the plain `checkout.stripe.com` with your logo is 95% of the effect at 0% of the operational cost.

3. **Full white-label is a completely different stack.** If you build a product where **your customers** accept payments (a marketplace, a platform for creators), Stripe Checkout branding is not enough — your customers need their own branding on their own checkouts. That requires **Stripe Connect**, which is a full platform product with its own onboarding, dashboard, and compliance burden (you become a "platform" under Stripe's ToS and inherit responsibilities for KYC, 1099s in the US, etc.). Don't go there unless your business model requires it. For a single-product SaaS like Contactly, branding your own Checkout is the right ceiling.

4. **A/B-test the impact if you can.** Stripe doesn't expose conversion data for branded vs unbranded (you had to make the call before setting up any funnel). But on significant rebrands, you can measure before/after checkout conversion in your own funnel analytics (`Started checkout` / `Completed checkout` events). Most teams see a 1-4% lift — hard to attribute causally, but consistent across the industry.

5. **Keep branding assets in source control.** Store the exact 512×512 PNG you uploaded in `design/stripe/` in your repo. When you rebrand in two years, you'll want the originals. Screenshot your colors + fonts + settings too — Stripe doesn't give you an "export branding config" button.

6. **Accessibility on Checkout is Stripe's problem, not yours.** You don't need to audit contrast ratios on the Stripe page — they already do that at the platform level and hold it to WCAG AA. What you do need to verify is **your brand color choice** doesn't break that guarantee. Picking a color with insufficient contrast makes your Stripe pages fail accessibility even though the underlying markup is fine. Contrast check your brand color against pure white.

---

## Summary

- Uploaded a 512×512 logo, 128×128 icon, brand color, and accent color via Stripe Dashboard → Settings → Business → Branding.
- Verified the branded Checkout renders correctly with a test purchase.
- Verified the Customer Portal inherits the branding and the return URL works.
- Understood why trust signals at the purchase step materially affect conversion.
- Learned the line between branded Checkout (us) vs fully white-label (Stripe Connect, different problem).

## What's Next

You've done it. Contactly now has toast notifications for rich feedback, hardened redirects that honor user intent, and a branded purchase experience that looks like a real product. There are no more technical lessons in the course.

The next (and final) document is a short, personal thank-you from me to you. You earned it — go read it.
