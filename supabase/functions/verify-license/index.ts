import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
        // `heartbeat: true` marks the background keep-alive ping (see
        // runHeartbeat() in index.html) vs. an actual login attempt from
        // the license-lock modal. Only a real login is allowed to bump
        // another device out of the 3-slot window (branch 5) — a heartbeat
        // from a device that's already been bumped just gets signed out.
        const { machineId, heartbeat } = await req.json()
        const supabase = createClient(
            Deno.env.get('CUSTOM_SUPABASE_URL')!,
            Deno.env.get('CUSTOM_SUPABASE_SERVICE_ROLE_KEY')!
        )

        // (2026-09-09, password auth) — email now comes from a real,
        // server-verified Supabase Auth session token instead of a bare
        // client-supplied string. Before this, anyone who knew a
        // customer's email could call this endpoint directly and register
        // a device slot / read entitlements with no password at all —
        // adding a password to the login form alone wouldn't have actually
        // stopped that unless this endpoint stopped trusting the client.
        const authHeader = req.headers.get('Authorization') || ''
        const token = authHeader.replace(/^Bearer\s+/i, '')
        if (!token) {
            return new Response(JSON.stringify({ authorized: false, has_character: false, has_dm: false, message: 'Not logged in.' }), { headers: corsHeaders })
        }
        const { data: userData, error: userError } = await supabase.auth.getUser(token)
        if (userError || !userData?.user?.email) {
            return new Response(JSON.stringify({ authorized: false, has_character: false, has_dm: false, message: 'Session expired — please log in again.' }), { headers: corsHeaders })
        }
        const email = userData.user.email.toLowerCase()

        // 1. Fetch the license record
        // We include 'expiry_date' to check for timed-out devices
        // has_character/has_dm (2026-09-08, license tier split) — returned
        // on every response below, alongside the existing single
        // `authorized` boolean, so the client can gate DM Tools separately
        // from the Character Sheet instead of treating any license as
        // "everything unlocked" the way it always used to.
        const { data, error } = await supabase
            .from('Licenses')
            .select('is_active, machine_id, expiry_date, has_character, has_dm')
            .eq('email', email)
            .single()

        if (error || !data || !data.is_active) {
            return new Response(JSON.stringify({ authorized: false, has_character: false, has_dm: false, message: 'Invalid or inactive license' }), { headers: corsHeaders })
        }

        const now = new Date();
        const ninetyDaysFromNow = new Date(now.getTime() + (90 * 24 * 60 * 60 * 1000)).toISOString();

        // Handle the comma-separated list of IDs
        let currentIds = data.machine_id ? data.machine_id.split(',').filter(Boolean) : []

        // 2. LOGIC: If this device is already registered
        if (currentIds.includes(machineId)) {
            // Update the server-side 90-day counter (expiry_date)
            await supabase
                .from('Licenses')
                .update({ expiry_date: ninetyDaysFromNow })
                .eq('email', email);

            return new Response(JSON.stringify({ authorized: true, has_character: data.has_character, has_dm: data.has_dm }), { headers: corsHeaders })
        }

        // 3. LOGIC: If this is a NEW device, check for timed-out old devices
        const expiryDate = new Date(data.expiry_date);

        // If the license hasn't checked in for 90 days, we "Release" all old slots
        if (data.expiry_date && now > expiryDate) {
            console.log(`License ${email} timed out. Resetting device slots.`);

            // Register ONLY the current new device and reset the timer
            await supabase
                .from('Licenses')
                .update({
                    machine_id: machineId,
                    expiry_date: ninetyDaysFromNow
                })
                .eq('email', email);

            return new Response(JSON.stringify({ authorized: true, has_character: data.has_character, has_dm: data.has_dm, message: 'License recovered on new device.' }), { headers: corsHeaders })
        }

        // 4. LOGIC: Standard device limit check (Max 3)
        if (currentIds.length < 3) {
            currentIds.push(machineId)
            await supabase
                .from('Licenses')
                .update({
                    machine_id: currentIds.join(','),
                    expiry_date: ninetyDaysFromNow
                })
                .eq('email', email)

            return new Response(JSON.stringify({ authorized: true, has_character: data.has_character, has_dm: data.has_dm }), { headers: corsHeaders })
        }

        // 5. Window is full (3 devices) and this one isn't in it.
        //
        // (2026-09-09) — "newest login wins, keep 3 devices": a real login
        // is never hard-blocked any more. It rolls the window — the
        // oldest-registered device drops off and this one takes its slot.
        // The dropped device signs itself out on its next heartbeat (it
        // lands right back here, but as a heartbeat, so it hits the branch
        // just below instead of rolling the window again). Someone sharing
        // a password with a 4th+ device ends up in a loop of knocking each
        // other's devices out, which stays annoying enough to discourage
        // sharing — without ever locking the real owner out of their own
        // extra device.
        if (heartbeat) {
            return new Response(JSON.stringify({
                authorized: false,
                has_character: data.has_character,
                has_dm: data.has_dm,
                message: 'Signed out — this account was used to sign in on another device.'
            }), { headers: corsHeaders })
        }

        const rolledIds = [...currentIds, machineId].slice(-3) // keep the 3 most-recently-added, self-heals any legacy over-length row
        await supabase
            .from('Licenses')
            .update({
                machine_id: rolledIds.join(','),
                expiry_date: ninetyDaysFromNow
            })
            .eq('email', email)

        return new Response(JSON.stringify({
            authorized: true,
            has_character: data.has_character,
            has_dm: data.has_dm,
            message: 'Signed in. Your oldest device was signed out to stay within the 3-device limit.'
        }), { headers: corsHeaders })

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: corsHeaders })
    }
})