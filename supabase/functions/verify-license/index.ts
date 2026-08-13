import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
        const { email, machineId } = await req.json()
        const supabase = createClient(
            Deno.env.get('CUSTOM_SUPABASE_URL')!,
            Deno.env.get('CUSTOM_SUPABASE_SERVICE_ROLE_KEY')!
        )

        // 1. Fetch the license record
        const { data, error } = await supabase
            .from('Licenses')
            .select('is_active, machine_id, expiry_date')
            .eq('email', email)
            .single()

        if (error || !data || !data.is_active) {
            return new Response(JSON.stringify({ authorized: false, message: 'Invalid or inactive license' }), { headers: corsHeaders })
        }

        const now = new Date();
        const ninetyDaysFromNow = new Date(now.getTime() + (90 * 24 * 60 * 60 * 1000)).toISOString();

        let currentIds = data.machine_id ? data.machine_id.split(',').filter(Boolean) : []

        if (currentIds.includes(machineId)) {
            await supabase
                .from('Licenses')
                .update({ expiry_date: ninetyDaysFromNow })
                .eq('email', email);

            return new Response(JSON.stringify({ authorized: true }), { headers: corsHeaders })
        }

        const expiryDate = new Date(data.expiry_date);

        if (data.expiry_date && now > expiryDate) {
            console.log(`License ${email} timed out. Resetting device slots.`);

            await supabase
                .from('Licenses')
                .update({
                    machine_id: machineId,
                    expiry_date: ninetyDaysFromNow
                })
                .eq('email', email);

            return new Response(JSON.stringify({ authorized: true, message: 'License recovered on new device.' }), { headers: corsHeaders })
        }

        if (currentIds.length < 3) {
            currentIds.push(machineId)
            await supabase
                .from('Licenses')
                .update({
                    machine_id: currentIds.join(','),
                    expiry_date: ninetyDaysFromNow
                })
                .eq('email', email)

            return new Response(JSON.stringify({ authorized: true }), { headers: corsHeaders })
        }

        return new Response(JSON.stringify({
            authorized: false,
            message: 'Device limit reached (Max 3). Inactive devices are removed automatically after 90 days.'
        }), { headers: corsHeaders })

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: corsHeaders })
    }
})