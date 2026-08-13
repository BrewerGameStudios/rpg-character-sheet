import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@11.1.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
    apiVersion: '2022-11-15',
    httpClient: Stripe.createFetchHttpClient(),
})

const cryptoProvider = Stripe.createSubtleCryptoProvider()

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
            const supabase = createClient(
                Deno.env.get('CUSTOM_SUPABASE_URL')!,
                Deno.env.get('CUSTOM_SUPABASE_SERVICE_ROLE_KEY')!
            )

            await supabase.from('Licenses').insert({
                email: event.data.object.customer_details.email,
                is_active: true
            })
        }

        return new Response(JSON.stringify({ received: true }), { status: 200 })
    } catch (err) {
        console.error(`WEBHOOK ERROR: ${err.message}`)
        return new Response(err.message, { status: 400 })
    }
})