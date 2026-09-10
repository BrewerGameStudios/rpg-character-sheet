import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@11.1.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
    apiVersion: '2022-11-15',
    httpClient: Stripe.createFetchHttpClient(),
})

const cryptoProvider = Stripe.createSubtleCryptoProvider()

// License tier split (2026-09-08, DM-Tester only for now) — each real
// Stripe Price ID maps to what buying it actually grants:
//   - CHARACTER_10: the SAME Price the existing $10 Payment Link
//     (buy.stripe.com/6oU00bdI08sW2jxcOtdQQ03) already uses — reused as-is,
//     per the decision to keep that link working exactly as customers
//     already know it, just narrowed to Character Sheet access only going
//     forward.
//   - DM_UPGRADE_20: a NEW Price ($20), only ever linked to from inside the
//     app for someone who already owns Character Sheet access — adds DM
//     Tools on top without touching has_character.
//   - BUNDLE_25: a NEW Price granting both at once, for someone buying
//     fresh with no existing license.
// Each entry only lists the columns THAT PURCHASE grants — upsert below
// only touches the columns actually present in the object it's given, so
// e.g. buying the $20 upgrade never resets has_character back to false on
// an existing row; it only ever adds has_dm.
const PRICE_ENTITLEMENTS: Record<string, { has_character?: boolean; has_dm?: boolean }> = {
    'price_1UDb5U1adsrnloiIdJtaZAlk': { has_character: true }, // Character Sheet — $10
    'price_1UDbDM1adsrnloiIlHEGZHgc': { has_dm: true }, // DM Tools upgrade — $20
    'price_1UDbEi1adsrnloiI1IMecK8a': { has_character: true, has_dm: true }, // Bundle — $25
}

serve(async (req) => {
    const signature = req.headers.get('stripe-signature')

    // Reading as text is the standard way to verify signatures in Deno
    const body = await req.text()

    try {
        const event = await stripe.webhooks.constructEventAsync(
            body,
            signature!,
            Deno.env.get('STRIPE_WEBHOOK_SIGNING_SECRET')!,
            undefined,
            cryptoProvider
        )

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object as Stripe.Checkout.Session
            const email = session.customer_details?.email

            if (!email) {
                console.error(`Checkout session ${session.id} completed with no customer email — nothing to license.`)
                return new Response(JSON.stringify({ received: true }), { status: 200 })
            }

            // The webhook payload itself doesn't carry which Price was
            // actually purchased — that's on the session's line items,
            // which need their own API call to fetch (Stripe doesn't
            // support expanding line_items on a webhook delivery, only on
            // a live API call like this one).
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id)
            const entitlements: { has_character?: boolean; has_dm?: boolean } = {}
            for (const item of lineItems.data) {
                const priceId = item.price?.id
                const grant = priceId ? PRICE_ENTITLEMENTS[priceId] : undefined
                if (grant) Object.assign(entitlements, grant)
            }

            if (Object.keys(entitlements).length === 0) {
                // Not a crash — just nothing this webhook recognizes (a
                // stale/removed Price, a typo in PRICE_ENTITLEMENTS
                // above, or a completely unrelated product). Logged so it
                // shows up in the function's own logs rather than
                // silently granting nothing with no trace.
                console.warn(`Session ${session.id} (${email}) matched no known Price in PRICE_ENTITLEMENTS — check the mapping.`)
            }

            const supabase = createClient(
                Deno.env.get('CUSTOM_SUPABASE_URL')!,
                Deno.env.get('CUSTOM_SUPABASE_SERVICE_ROLE_KEY')!
            )

            // upsert, not insert — a repeat purchase (the $20 upgrade,
            // most obviously) needs to UPDATE this same customer's
            // existing row, not create a second one (which would then
            // break verify-license's own .single() lookup by email).
            // Needs the unique constraint on email from this feature's own
            // migration for onConflict to have anything to conflict against.
            await supabase.from('Licenses').upsert(
                { email, is_active: true, ...entitlements },
                { onConflict: 'email' }
            )

            // Auto-invite (2026-09-09, password auth, DM-Tester only for
            // now) — this is what actually closes the gap password auth
            // exists to fix: the "set your password" link only ever goes
            // out to the email Stripe itself collected at checkout, so
            // only the real inbox owner can ever set the account's
            // password. inviteUserByEmail creates the Supabase Auth
            // account and sends that link automatically. If they already
            // have an account (e.g. this is the $20 upgrade on an existing
            // Character-only customer), it errors — caught and logged
            // below rather than thrown, since they already have a password
            // and don't need a second invite; this must never break the
            // license upsert above, which already succeeded.
            try {
                const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
                    redirectTo: 'https://rpg-character-sheet-tester.netlify.app/menu.html'
                })
                if (inviteError) {
                    console.log(`Invite not sent for ${email} (likely already has an account): ${inviteError.message}`)
                }
            } catch (inviteErr) {
                console.error(`Invite call threw for ${email}: ${inviteErr.message}`)
            }
        }

        return new Response(JSON.stringify({ received: true }), { status: 200 })
    } catch (err) {
        console.error(`WEBHOOK ERROR: ${err.message}`)
        return new Response(err.message, { status: 400 })
    }
})