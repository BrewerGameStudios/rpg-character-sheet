// shared.js — the first real piece of the shared.js/shared.css split planned
// for DM Tools. Loaded by both index.html and dm.html (after the Supabase
// CDN script tag, which this depends on). Anything added here should be
// genuinely proven-stable code already working in the player sheet — never
// anything written fresh for DM Tools, since keeping this file small is
// what keeps a bug in brand-new DM code from ever being able to reach the
// player sheet.

const supabaseUrl = 'https://bkfwuueflwsfzktkuxpk.supabase.co';
const supabaseKey = 'sb_publishable_DK79mZfep1vfYGmhspaFdA_qTYte9tF';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// --- BROWSER-SAFE HARDWARE ID GENERATION ---
let myUniqueId = localStorage.getItem('rpg_browser_id');
if (!myUniqueId) {
    myUniqueId = 'device-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('rpg_browser_id', myUniqueId);
}

// entitlements (2026-09-08, license tier split, DM-Tester only for now) —
// {has_character, has_dm} from verify-license's own response. Optional so
// every EXISTING call site (this function predates the split) still works
// exactly as before if it doesn't pass one — restrictedFeature() below
// only actually checks licenseHasDM when gating 'DM Tools' specifically,
// so an old caller just means that check falls through to "no", which
// only matters once dm.html's own gating is live anyway.
function loginLicense(email, entitlements) {
    // Force lowercase to prevent caps-lock issues later
    const cleanEmail = email.trim().toLowerCase();
    localStorage.setItem('isActivated', 'true');
    localStorage.setItem('licenseEmail', cleanEmail);
    if (entitlements) {
        localStorage.setItem('licenseHasCharacter', entitlements.has_character ? 'true' : 'false');
        localStorage.setItem('licenseHasDM', entitlements.has_dm ? 'true' : 'false');
    }
    console.log("Session started for: " + cleanEmail);
}

// Moved here from index.html (2026-08-20) once the "Log Out" button moved
// to menu.html — same reasoning as loginLicense() above: localStorage is
// shared across every page at this origin, so this never needed to be
// index.html-specific in the first place, just hadn't been asked to move
// yet. Still called from index.html too (a failed license heartbeat in
// runHeartbeat() logs out automatically) as well as menu.html's own
// Log Out button.
function logoutLicense() {
    if (confirm("Are you sure you want to log out? This will lock premium features on this device until you activate again.")) {
        // Removes the "paid" flag from your browser's memory
        localStorage.removeItem('isActivated');
        // Optional: clear the email if you want a total reset
        localStorage.removeItem('licenseEmail');
        localStorage.removeItem('licenseHasCharacter');
        localStorage.removeItem('licenseHasDM');

        alert("Logged out successfully. The sheet is now in Trial Mode.");
        location.reload();
    }
}

// Finishes logging in once a real Supabase Auth session already exists
// (2026-09-09, password auth) — shared by the normal Log In button and by
// initSetPasswordButton() below, since setting a password via an
// invite/recovery link already leaves the browser signed in and there's no
// reason to make someone re-type credentials they just proved they know.
// Sends the session's own access token instead of a client-supplied email —
// verify-license derives the email itself from that token server-side, so
// this call only ever works for someone who actually authenticated.
async function completeLogin(email) {
    const statusDiv = document.getElementById('lock-status');
    const machineId = localStorage.getItem('rpg_browser_id');
    const { data: sessionData } = await _supabase.auth.getSession();
    const token = sessionData && sessionData.session ? sessionData.session.access_token : null;
    if (!token) {
        if (statusDiv) { statusDiv.style.color = "#f44336"; statusDiv.innerText = "Session error — please try logging in again."; }
        return;
    }
    if (statusDiv) { statusDiv.style.color = "#ffeb3b"; statusDiv.innerText = "Connecting to server..."; }
    try {
        const response = await fetch('https://bkfwuueflwsfzktkuxpk.supabase.co/functions/v1/verify-license', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ machineId })
        });
        const result = await response.json();
        if (result.authorized) {
            loginLicense(email, result);
            localStorage.setItem('lastServerCheck', Date.now());
            // (2026-09-08, license tier split) — names what's actually
            // unlocked instead of a blanket "fully activated", since
            // that's no longer always true (a Character-only license
            // is a real, valid, working activation now, not a partial
            // failure).
            const unlocked = result.has_dm ? "Character Sheet + DM Tools" : "Character Sheet";
            // result.message is set when verify-license had to roll the
            // 3-device window (an older device got signed out) — worth
            // telling the person so a device dropping off later isn't a
            // mystery.
            const extra = result.message ? `\n\n${result.message}` : "";
            alert(`Success! Your ${unlocked} access is activated.${extra}`);
            location.reload();
        } else {
            // Authenticated fine but verify-license itself refused (device
            // limit, inactive license) — don't leave a signed-in Supabase
            // session sitting around for someone who isn't actually
            // getting in.
            await _supabase.auth.signOut();
            if (statusDiv) {
                statusDiv.style.color = "#f44336";
                statusDiv.innerText = "Error: " + (result.message || "Invalid license.");
            }
        }
    } catch (err) {
        if (statusDiv) {
            statusDiv.style.color = "#f44336";
            statusDiv.innerText = "Connection error.";
        }
    }
}

// Wires up the #activate-btn ("Log In") inside a page's own #license-lock
// modal. Both index.html and dm.html have their own copy of that modal, but
// the login logic only needs to exist once.
//
// (2026-09-09, password auth) — a real password check via Supabase Auth
// now gates this, replacing the old email-only flow. Before this, anyone
// who just knew (or guessed) a customer's email could activate on their
// own device as long as a device slot was free — verify-license itself was
// never actually protected by anything. signInWithPassword is what closes
// that: verify-license below now only ever runs for someone who already
// proved they know the password.

// Show/Hide toggle for any password field in #license-lock (2026-09-09) —
// one generic function reused by all three password inputs (login,
// new-password, new-password-confirm) across index.html/dm.html/menu.html.
function togglePasswordVisibility(inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    if (btnEl) btnEl.textContent = showing ? 'Show' : 'Hide';
}

function initActivateButton() {
    const activateBtn = document.getElementById('activate-btn');
    if (!activateBtn) return;
    activateBtn.onclick = async () => {
        const emailInput = document.getElementById('license-email');
        const passwordInput = document.getElementById('license-password');
        const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
        const password = passwordInput ? passwordInput.value : "";
        const statusDiv = document.getElementById('lock-status');

        if (!email || !password) {
            if (statusDiv) { statusDiv.style.color = "#f44336"; statusDiv.innerText = "Please enter your email and password."; }
            return;
        }

        if (statusDiv) { statusDiv.style.color = "#ffeb3b"; statusDiv.innerText = "Logging in..."; }

        const { error: authError } = await _supabase.auth.signInWithPassword({ email, password });
        if (authError) {
            if (statusDiv) { statusDiv.style.color = "#f44336"; statusDiv.innerText = "Incorrect email or password."; }
            return;
        }

        // "Remember password" (2026-09-09) — see prefillRememberedCredentials()
        // below for the read side and the tradeoff this makes (plaintext in
        // localStorage). This is separate from staying logged in, which
        // already happens automatically via Supabase's own persisted
        // session — this only saves a retype after a log-out or a fresh
        // browser profile.
        const rememberCheckbox = document.getElementById('remember-password-checkbox');
        if (rememberCheckbox && rememberCheckbox.checked) {
            localStorage.setItem('rememberedCredentials', JSON.stringify({ email, password }));
        } else {
            localStorage.removeItem('rememberedCredentials');
        }

        await completeLogin(email);
    };
}

// Pre-fills the login form from a "Remember password" save (2026-09-09).
// Stores the raw password in plaintext in localStorage — readable by
// anyone with access to this browser profile or its devtools. A
// deliberate, proportionate tradeoff for this app's low-stakes,
// friends-and-family scale; not a pattern to carry over if this app ever
// handles more sensitive accounts.
function prefillRememberedCredentials() {
    const raw = localStorage.getItem('rememberedCredentials');
    if (!raw) return;
    try {
        const { email, password } = JSON.parse(raw);
        const emailInput = document.getElementById('license-email');
        const passwordInput = document.getElementById('license-password');
        const checkbox = document.getElementById('remember-password-checkbox');
        if (emailInput && email) emailInput.value = email;
        if (passwordInput && password) passwordInput.value = password;
        if (checkbox) checkbox.checked = true;
    } catch (e) {
        localStorage.removeItem('rememberedCredentials');
    }
}

// "Forgot password?" link inside #license-lock (2026-09-09, password
// auth) — resetPasswordForEmail sends the reset email itself via
// Supabase's built-in mailer (no custom email service needed) and never
// reveals whether the address actually has an account, so the UI can't
// (and shouldn't) distinguish "sent" from "no such account" either.
// (2026-09-09) — wires up BOTH #forgot-password-link and
// #login-change-password-link to the same handler. Someone who already
// knows their password (e.g. it's just their email, per the temporary
// bridge every existing customer was set to) may not think to click
// "Forgot password?" since they didn't forget it — a second link labeled
// "Change password" covers that mental model, but there's no already-
// logged-in session to change FROM at the login screen, so it's really
// the same resetPasswordForEmail flow under a different label rather than
// a distinct mechanism.
function initForgotPasswordLink() {
    const links = [
        document.getElementById('forgot-password-link'),
        document.getElementById('login-change-password-link')
    ].filter(Boolean);
    if (!links.length) return;
    const handleClick = async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('license-email');
        const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
        const statusDiv = document.getElementById('lock-status');
        if (!email) {
            if (statusDiv) { statusDiv.style.color = "#f44336"; statusDiv.innerText = 'Enter your email above first, then click "Forgot password?" or "Change password".'; }
            return;
        }
        if (statusDiv) { statusDiv.style.color = "#ffeb3b"; statusDiv.innerText = "Sending reset email..."; }
        const { error } = await _supabase.auth.resetPasswordForEmail(email, {
            redirectTo: 'https://rpg-character-sheet-tester.netlify.app/menu.html'
        });
        if (statusDiv) {
            statusDiv.style.color = error ? "#f44336" : "#4caf50";
            statusDiv.innerText = error ? "Could not send reset email." : "Check your email for a reset link.";
        }
    };
    links.forEach(link => { link.onclick = handleClick; });
}

// "Login issue?" link inside #login-fields (2026-09-09) — for anything
// Forgot Password / Change Password don't cover (account confusion,
// something looking broken, etc.). Opens the visitor's own email client
// via a mailto: link addressed to support, pre-filled with whatever email
// they'd typed into the login field so support has that context without
// them needing to retype it — sent from their own real inbox, so support
// gets a genuine reply-able email, not anything routed through the app.
function initLoginIssueLink() {
    const link = document.getElementById('login-issue-link');
    if (!link) return;
    link.onclick = (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('license-email');
        const email = emailInput ? emailInput.value.trim() : "";
        const subject = encodeURIComponent('Login Issue');
        const body = encodeURIComponent(
            `Account email: ${email || '(not entered)'}\n\nDescribe what's happening:\n`
        );
        window.location.href = `mailto:BrewerGameStudios@gmail.com?subject=${subject}&body=${body}`;
    };
}

// Wires up #set-password-btn, shown instead of the normal login fields
// once initPasswordRecoveryDetection() below spots an invite/recovery
// session. Goes straight into completeLogin() on success rather than
// forcing a second manual login — they already proved they own the
// account by clicking the emailed link.
function initSetPasswordButton() {
    const btn = document.getElementById('set-password-btn');
    if (!btn) return;
    btn.onclick = async () => {
        const pw1El = document.getElementById('new-password');
        const pw2El = document.getElementById('new-password-confirm');
        const pw1 = pw1El ? pw1El.value : "";
        const pw2 = pw2El ? pw2El.value : "";
        const statusDiv = document.getElementById('lock-status');

        if (!pw1 || pw1.length < 8) {
            if (statusDiv) { statusDiv.style.color = "#f44336"; statusDiv.innerText = "Password must be at least 8 characters."; }
            return;
        }
        if (pw1 !== pw2) {
            if (statusDiv) { statusDiv.style.color = "#f44336"; statusDiv.innerText = "Passwords don't match."; }
            return;
        }

        if (statusDiv) { statusDiv.style.color = "#ffeb3b"; statusDiv.innerText = "Saving password..."; }
        const { data, error } = await _supabase.auth.updateUser({ password: pw1 });
        if (error) {
            if (statusDiv) { statusDiv.style.color = "#f44336"; statusDiv.innerText = "Could not set password: " + error.message; }
            return;
        }
        await completeLogin(data.user.email);
    };
}

// Toggles the modal between its normal login form and the "set a password"
// form used for invite/recovery links (2026-09-09, password auth). Also
// reused directly by menu.html's "Change Password" button for an
// already-logged-in user, so the wording stays neutral rather than
// assuming this is always someone's first time setting one.
function showSetPasswordFields(email) {
    const loginFields = document.getElementById('login-fields');
    const setPwFields = document.getElementById('set-password-fields');
    const pricingWrap = document.getElementById('pricing-picker-wrap');
    const upgradeWrap = document.getElementById('dm-upgrade-only-wrap');
    if (loginFields) loginFields.style.display = 'none';
    if (pricingWrap) pricingWrap.style.display = 'none';
    if (upgradeWrap) upgradeWrap.style.display = 'none';
    if (setPwFields) setPwFields.style.display = 'block';
    const lockMsg = document.getElementById('lock-message');
    if (lockMsg) lockMsg.innerHTML = email
        ? `Set a new password for <b>${email}</b>.`
        : 'Set a new password.';
    const lock = document.getElementById('license-lock');
    if (lock) lock.style.display = 'flex';
}
function showLoginFields() {
    const loginFields = document.getElementById('login-fields');
    const setPwFields = document.getElementById('set-password-fields');
    const pricingWrap = document.getElementById('pricing-picker-wrap');
    if (loginFields) loginFields.style.display = 'block';
    if (setPwFields) setPwFields.style.display = 'none';
    if (pricingWrap) pricingWrap.style.display = 'block';
}

// Detects an invite/recovery link's session on page load (2026-09-09,
// password auth). Both admin.inviteUserByEmail (stripe-webhook, on
// purchase) and resetPasswordForEmail (the link above) land back here with
// Supabase Auth tokens in the URL hash; the SDK auto-parses them into a
// real session (detectSessionInUrl, on by default) and — confirmed against
// Supabase's own docs/issue tracker — fires PASSWORD_RECOVERY for BOTH
// link types, since invite and recovery links share the same underlying
// mechanism. The direct hash check is just a backup for the rare case this
// listener attaches after the SDK already processed the URL.
function initPasswordRecoveryDetection() {
    _supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session) {
            showSetPasswordFields(session.user.email);
        }
    });
    const hash = window.location.hash || '';
    if (hash.includes('type=invite') || hash.includes('type=recovery')) {
        setTimeout(async () => {
            const { data } = await _supabase.auth.getSession();
            if (data && data.session) {
                showSetPasswordFields(data.session.user.email);
                // Scrub the access token out of the visible URL/history.
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        }, 300);
    }
}

// --- RICH-TEXT NOTES EDITOR ---
// Built for index.html's Campaign & Character Notes tab (stable since
// v2.3.0), pulled in here as-is so dm.html's Story Tracker (Phase 04) can
// reuse the exact same toolbar/editor mechanics instead of a second
// implementation. Everything here operates on whichever element has class
// "notes-editor" and is currently focused/active — each page only ever has
// one such editor live at a time, so there's no need to plumb an editor id
// through every call site.
//
// Saving is deliberately NOT handled here — index.html autosaves to
// localStorage, dm.html saves to Supabase, and those are different enough
// (and DM-Tools-specific enough) that baking either into shared.js would
// break the whole point of this file. Instead formatDoc() fires a
// 'notes:changed' event on the editor after every toolbar-driven edit, and
// each page wires up its own listener to that for its own save logic.
// Plain typing already bubbles a native 'input' event on the editor, which
// each page also listens for directly.

let lastSelection = null;

function saveSelection() {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        lastSelection = sel.getRangeAt(0);
    }
}

function restoreSelection() {
    if (lastSelection) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(lastSelection);
    }
}

// A real, otherwise-never-used hex used only as a throwaway marker — see
// formatDoc's isNormalColor branch below for why execCommand needs a real
// color here rather than the var(--notes-normal-color) reference this is
// standing in for (that reference can't go directly into execCommand's
// legacy <font color="..."> attribute at all — confirmed live, it silently
// produces a fully transparent color instead).
const NOTES_NORMAL_COLOR_SENTINEL = '#010203';
function convertNormalColorSentinels(editor) {
    editor.querySelectorAll('font[color="' + NOTES_NORMAL_COLOR_SENTINEL + '"]').forEach(font => {
        const span = document.createElement('span');
        span.style.color = 'var(--notes-normal-color)';
        while (font.firstChild) span.appendChild(font.firstChild);
        font.replaceWith(span);
    });
}

function formatDoc(cmd, value = null) {
    const editor = document.querySelector('.notes-editor');
    if (!editor) return;

    // 1. If we are using a dropdown or picker, restore the highlighted text first
    if (lastSelection) {
        restoreSelection();
    }

    // Capture this before execCommand runs: a collapsed cursor (nothing
    // selected) is the "about to type" case — foreColor there just arms the
    // browser's internal pending typing style and doesn't touch the DOM at
    // all until a character is actually typed, so there's nothing yet for
    // the normal computed-style toolbar detection to see.
    const sel = window.getSelection();
    const wasCollapsed = sel.rangeCount > 0 && sel.getRangeAt(0).collapsed;

    // Commands like insertUnorderedList restructure the selection into a
    // brand-new <ul><li> block, and browsers are inconsistent about whether
    // Bold/Italic/Underline that was active going in survives that
    // restructuring — it can get silently dropped. Snapshot it first (skip
    // when the command being run *is* one of these three — that's a
    // deliberate toggle, not something to protect against) so it can be put
    // back if it disappears.
    const trackedStyles = ['bold', 'italic', 'underline', 'strikeThrough'];
    let stylesBefore = null;
    if (!trackedStyles.includes(cmd)) {
        stylesBefore = {};
        trackedStyles.forEach(s => { stylesBefore[s] = document.queryCommandState(s); });
    }

    // 2. Apply the formatting
    // "Normal" gets a real sentinel hex here instead of the var(...)
    // reference (see convertNormalColorSentinels above), then gets
    // converted right after into something that actually holds the CSS
    // variable.
    const isNormalColor = cmd === 'foreColor' && value === 'var(--notes-normal-color)';
    document.execCommand(cmd, false, isNormalColor ? NOTES_NORMAL_COLOR_SENTINEL : value);
    if (isNormalColor) convertNormalColorSentinels(editor);

    if (stylesBefore) {
        trackedStyles.forEach(s => {
            if (stylesBefore[s] && !document.queryCommandState(s)) {
                document.execCommand(s, false, null);
            }
        });
    }

    // Any block just converted to a heading (formatBlock) needs its
    // collapse toggle — cheap/idempotent for every other command too, so no
    // need to gate this on cmd === 'formatBlock' specifically.
    ensureHeadingToggles(editor);

    // 3. Put focus back in the editor and clear the saved selection
    editor.focus();
    lastSelection = null;

    // Toolbar clicks (mousedown, not typing) don't reliably bubble an
    // 'input' event the way typing does, so let interested pages know
    // directly here — otherwise formatting text and then walking away
    // without typing another keystroke could leave that formatting unsaved.
    editor.dispatchEvent(new CustomEvent('notes:changed', { bubbles: true }));

    if (cmd === 'foreColor' && wasCollapsed && value) {
        // Nothing was wrapped in the DOM to detect yet, so light up the
        // picked swatch directly — otherwise it stayed dark until after the
        // first character was typed, leaving no way to tell a color was
        // actually armed. "Normal" is matched by its var(...) reference
        // rather than by dataset.color === hex.
        const hex = value.toLowerCase();
        document.querySelectorAll('.color-swatch').forEach(sw => {
            sw.classList.toggle('selected', isNormalColor ? sw.dataset.color === 'normal' : sw.dataset.color === hex);
        });
    } else {
        updateNotesToolbarState();
    }
}

// Real placeholder behavior for the contenteditable editor — without this,
// "Start typing..." would be hardcoded directly into the content and become
// permanent saved text the moment someone typed without deleting it first.
function updateNotesPlaceholder(editor) {
    editor = editor || document.querySelector('.notes-editor');
    if (!editor) return;
    const isEmpty = editor.textContent.trim() === '' && !editor.querySelector('img, ul, ol');
    editor.classList.toggle('is-empty', isEmpty);
    // Cheap enough to run on every keystroke (single element, no rebuild) —
    // keeps the active tab's label reading as "whatever the first line
    // currently says" without waiting for a page switch or save. See the
    // "NOTES PAGES" comment further down for the full picture.
    updateActiveTabLabel(editor);
}

// execCommand reports colors back as "rgb(r, g, b)", but the swatch buttons
// are keyed by hex — normalize so they can be compared.
function rgbStringToHex(rgbStr) {
    const match = rgbStr && rgbStr.match(/\d+/g);
    if (!match || match.length < 3) return null;
    return '#' + match.slice(0, 3).map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
}

// Highlights Bold/Italic/Underline, and whichever color swatch matches the
// text color, in the toolbar to match whatever's active at the
// cursor/selection — the way Google Docs shows which styles are "on" as you
// move around the document.
//
// Color detection deliberately does NOT use document.queryCommandValue
// ('foreColor') — that API is deprecated and proved unreliable in testing
// (e.g. it can keep reporting the last-applied color for a plain, uncolored
// cursor position). Instead this walks up from the actual selection to the
// nearest element and asks getComputedStyle for the real rendered color,
// which always matches what's on screen in both light and dark mode
// regardless of how deeply the <font> tags are nested.
function updateNotesToolbarState() {
    const editor = document.activeElement;
    if (!editor || !editor.classList || !editor.classList.contains('notes-editor')) return;

    // A real, fresh selection now exists directly in the editor, so any
    // range stashed earlier by saveSelection() (e.g. the user opened the
    // font-size dropdown or the custom color picker, then clicked back into
    // the editor without actually picking anything) is obsolete. Leaving it
    // behind meant the *next* plain color-swatch click — which doesn't call
    // saveSelection() itself — could silently restore that stale/detached
    // range instead of the selection the user can actually see, making
    // color changes and the toolbar highlight seem to randomly not apply to
    // the right text.
    lastSelection = null;

    ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList'].forEach(cmd => {
        const btn = document.querySelector(`.btn-tool[data-cmd="${cmd}"]`);
        if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
    });

    let currentHex = null;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        let node = sel.getRangeAt(0).startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        if (node && editor.contains(node)) {
            currentHex = rgbStringToHex(getComputedStyle(node).color);
        }
    }
    // getComputedStyle(node).color above already resolves color:var(--notes-
    // normal-color) down to its real rendered rgb() for whichever theme is
    // active right now — so text colored via "Normal" is detected by
    // comparing currentHex against that same variable's CURRENT value (read
    // fresh each time), not a fixed hex like the other swatches use.
    const normalHex = getComputedStyle(editor).getPropertyValue('--notes-normal-color').trim().toLowerCase();
    document.querySelectorAll('.color-swatch').forEach(sw => {
        const isNormalSwatch = sw.dataset.color === 'normal';
        sw.classList.toggle('selected', !!currentHex && (isNormalSwatch ? currentHex === normalHex : sw.dataset.color === currentHex));
    });
}
document.addEventListener('selectionchange', updateNotesToolbarState);
// Toolbar controls that can't safely preventDefault their mousedown (the
// font-size <select>, the native custom-color <input>) briefly steal focus
// away from the editor, which made the toolbar state freeze stale until the
// *next* selection change. Refreshing again the moment focus lands back on
// the editor makes it self-heal immediately instead of staying stuck.
document.addEventListener('DOMContentLoaded', () => {
    const editor = document.querySelector('.notes-editor');
    if (editor) {
        editor.addEventListener('focus', updateNotesToolbarState);
        editor.addEventListener('mousedown', handleNotesEditorMousedown);
        editor.addEventListener('keydown', handleNotesEditorKeydown);
        // Covers clicking "Normal" with a collapsed cursor (nothing
        // selected) then typing — execCommand arms its pending style for
        // the next character using the sentinel hex, so the freshly-typed
        // character lands wrapped in a real <font color="sentinel">. Same
        // conversion formatDoc's isNormalColor branch runs immediately on
        // an existing selection, just triggered by typing instead.
        editor.addEventListener('input', () => convertNormalColorSentinels(editor));
    }
});

// --- COLLAPSIBLE TITLES ---
// The Title dropdown (a second, separate select from the Normal/Small/
// Large/Huge one) runs formatDoc('formatBlock', '<h1>') etc., turning the
// current block into a real <h1>-<h4> — a proper block element, not just an
// inline font-size span, which is what makes "collapse everything under
// this heading" possible at all.
//
// The collapse caret is a real element (a <span contenteditable="false">),
// not a CSS ::before hit-tested by pixel distance — that was the original
// approach and it broke in real Chrome (font metrics/zoom don't match a
// hardcoded guess closely enough, so clicks on the caret were silently
// missing it). contenteditable="false" is the standard technique other
// rich editors use for inline widgets living inside editable content
// (mention chips, checkboxes, etc.) — browsers treat it as a single atomic,
// non-editable unit: can't be typed into, and normal clicks land on it
// precisely via a real getBoundingClientRect(), no guessing required.
const HEADING_LEVELS = { H1: 1, H2: 2, H3: 3, H4: 4 };

// Tab inside a bullet list indents the current item into a nested sub-list
// (Shift+Tab un-indents it back out) — the standard convention every other
// outliner/notes app uses (Notion, Google Docs, Word). Only takes over Tab
// when the cursor is actually inside an <li>; anywhere else Tab is left
// completely alone (e.g. tabbing between other page controls). execCommand
// 'indent'/'outdent' already does exactly this for list items reliably — no
// need for the by-hand DOM surgery the Enter/heading case above needed.
function handleNotesEditorTab(e) {
    const editor = e.currentTarget;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const li = node ? node.closest('li') : null;
    if (!li || !editor.contains(li)) return;

    e.preventDefault();
    // BUG FIX (2026-09-02, "tabbing... not working right on Apple") — this
    // used to hand off to document.execCommand('indent'/'outdent'), a
    // long-deprecated API whose actual nested-list behavior is notoriously
    // inconsistent across browsers; Safari/iOS's own version of it is
    // known to produce different (or no) results here than Chrome's,
    // which is exactly the kind of "native contenteditable behavior can't
    // be trusted" problem the Enter-in-heading fix above already hit —
    // see its own comment. Doing the move by hand (indentListItem/
    // outdentListItem) produces the exact same <ul><li><ul><li>...
    // nesting shape the existing per-level bullet CSS already expects,
    // just without relying on any browser's own implementation of it.
    //
    // Cursor position is saved as a plain (node, offset) pair, NOT a
    // cloned Range — confirmed live that a Range's boundary does not
    // reliably keep tracking its original text node across the two-step
    // reparent indent/outdent does (create/find a sublist, then move the
    // <li> into it); the browser silently promotes the boundary up to a
    // shared ancestor instead. The original text node itself is still
    // very much alive and attached afterward (just moved, not replaced),
    // so building a brand-new Range against that same node/offset once
    // the move is done, rather than trying to reuse one that lived
    // through it, is what actually lands the caret back where it was.
    const startNode = sel.getRangeAt(0).startContainer;
    const startOffset = sel.getRangeAt(0).startOffset;
    if (e.shiftKey) outdentListItem(li); else indentListItem(li);
    const restored = document.createRange();
    restored.setStart(startNode, startOffset);
    restored.collapse(true);
    sel.removeAllRanges();
    sel.addRange(restored);
    editor.dispatchEvent(new CustomEvent('notes:changed', { bubbles: true }));
}
// Nests `li` one level deeper, under a new or existing sublist inside the
// PREVIOUS sibling <li> — standard indent behavior (Notion/Word/Google
// Docs all indent "under whatever's directly above you"). No-op if `li`
// is already the first item in its list, matching every other editor:
// there's nothing above it to nest under.
function indentListItem(li) {
    const prev = li.previousElementSibling;
    if (!prev || prev.tagName !== 'LI') return;
    const listTag = li.parentElement.tagName; // UL — matches whatever list `li` is already in
    let sublist = prev.querySelector(':scope > ' + listTag);
    if (!sublist) {
        sublist = document.createElement(listTag);
        prev.appendChild(sublist);
    }
    sublist.appendChild(li);
}
// Moves `li` out of its current nested list to become a sibling of the
// <li> that list itself is nested inside, right after it — the reverse
// of indentListItem. No-op if `li` is already at the top level (nothing
// to outdent into), matching every other editor. Cleans up the nested
// list if outdenting emptied it out entirely.
function outdentListItem(li) {
    const parentList = li.parentElement;
    const grandparentLi = parentList.parentElement;
    if (!grandparentLi || grandparentLi.tagName !== 'LI') return;
    const outerList = grandparentLi.parentElement;
    outerList.insertBefore(li, grandparentLi.nextSibling);
    if (!parentList.querySelector(':scope > li')) parentList.remove();
}

// Pressing Enter at the end of a heading in a plain contenteditable div has
// genuinely unreliable native behavior — observed in real Chrome testing to
// sometimes nest a brand-new heading *inside* the current one instead of
// creating a sibling after it (e.g. typing a Title 1, pressing Enter,
// applying Title 2 to the new line could end up as
// `<h1><h2>...</h2></h1>`), silently breaking the flat sibling structure
// collapse depends on. Rather than trust that, Enter is intercepted here
// whenever the cursor is inside a heading and the split is done by hand:
// whatever comes after the cursor moves into a new plain <div> placed right
// after the heading — matching how every other editor treats "Enter inside
// a heading" (it starts a new normal line, not another heading; that also
// matches this app's own workflow, where each new line gets its Title
// level picked explicitly from the dropdown afterward). Shift+Enter is left
// alone — that's a soft line break staying inside the same heading, and
// native behavior for that is fine.
function handleNotesEditorKeydown(e) {
    if (e.key === 'Tab') {
        handleNotesEditorTab(e);
        return;
    }

    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;

    const editor = e.currentTarget;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);

    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const heading = node ? node.closest('h1, h2, h3, h4') : null;
    if (!heading || !editor.contains(heading)) return;

    e.preventDefault();

    // A non-collapsed selection (some text highlighted) needs deleting
    // first — deleteContents() also collapses the range to that point,
    // which is exactly the split point wanted below.
    if (!range.collapsed) range.deleteContents();

    const afterRange = document.createRange();
    afterRange.selectNodeContents(heading);
    afterRange.setStart(range.startContainer, range.startOffset);
    const afterFragment = afterRange.extractContents();

    const newBlock = document.createElement('div');
    if (afterFragment.textContent.trim() === '' && !afterFragment.querySelector('img, ul, ol')) {
        // Nothing came after the cursor (the common case — type a whole
        // title, then Enter) — an empty div needs a <br> or it won't be
        // focusable/visible as its own line.
        newBlock.appendChild(document.createElement('br'));
    } else {
        newBlock.appendChild(afterFragment);
    }
    heading.parentNode.insertBefore(newBlock, heading.nextSibling);

    const newRange = document.createRange();
    newRange.setStart(newBlock, 0);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    updateNotesPlaceholder(editor);
    editor.dispatchEvent(new CustomEvent('notes:changed', { bubbles: true }));
}

// --- NOTES PAGES ---
// A notebook of up to 5 independent pages sharing one editor/toolbar — only
// the active page's HTML is ever actually in the DOM; the rest live in
// notesPages while they're not on screen. Each tab is labeled with its
// page's own first line, computed live (not typed in) — real folder-tab
// shape, dividing the available width evenly via plain flexbox (flex:1 on
// each tab already gives "2 tabs=50/50, 3=33/33/33" etc. for free, no width
// math needed).
//
// Persistence is deliberately NOT handled here, same reasoning as the rest
// of this file: index.html stores notesPages as a plain JS array (its
// character data is saved as one big JSON blob already, so an array needs
// no extra encoding); dm.html's story_notes is a real SQL text column, so
// it JSON.stringifies the array itself before saving. getNotesPagesForSave()
// below hands back the plain array either way — what a caller does with
// that array is entirely up to it. Switching/adding a page reuses the same
// 'notes:changed' event as everything else in this file, so both pages'
// already-existing save listeners pick it up with no new wiring.
let notesPages = [''];
let activeNotesPageIndex = 0;
const MAX_NOTES_PAGES = 5;

// Accepts whatever shape notes might arrive in — a fresh array (the normal
// case going forward), a JSON-encoded string of one (dm.html's story_notes
// column), or a plain HTML string (everything saved before this feature
// existed, on either page) — and always returns a real array, so every
// caller downstream can stop caring which of those it actually got.
function normalizeNotesPages(raw) {
    if (Array.isArray(raw)) return raw.length ? raw.slice(0, MAX_NOTES_PAGES) : [''];
    if (typeof raw === 'string' && raw.trim().startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.length ? parsed.slice(0, MAX_NOTES_PAGES) : [''];
        } catch (e) {
            // Not actually JSON — just legacy HTML that happens to start
            // with "[", fall through and treat it as page 1's content.
        }
    }
    return [raw || ''];
}

// A page's tab label isn't typed in anywhere — it's always derived live
// from that page's own content, same idea as a browser tab taking its
// title from the page. Reads the first heading/paragraph/list-item rather
// than the page's entire (possibly long) textContent.
function getFirstLineLabel(html, fallback) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    let first = tmp.firstElementChild;
    if (first && (first.tagName === 'UL' || first.tagName === 'OL')) {
        first = first.querySelector('li') || first;
    }
    const text = (first ? first.textContent : tmp.textContent).trim();
    if (!text) return fallback;
    return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

function captureActivePageContent(editor) {
    editor = editor || document.querySelector('.notes-editor');
    if (!editor) return;
    notesPages[activeNotesPageIndex] = editor.innerHTML;
}

function loadActivePageContent(editor) {
    editor = editor || document.querySelector('.notes-editor');
    if (!editor) return;
    editor.innerHTML = notesPages[activeNotesPageIndex] || '';
    updateNotesPlaceholder(editor);
    syncNotesCollapseState(editor);
}

// Built with real DOM methods (not innerHTML + string interpolation) so a
// page's own typed content — which is exactly what ends up as a tab label —
// can never be interpreted as markup.
//
// Each tab is a plain <div onclick> rather than a <button> — same pattern
// the bottom-nav .nav-items already use in both pages — specifically so it
// can hold the close (×) button as a real nested <button> without the
// invalid-HTML problem of a button inside a button. That close button DOES
// stay a real <button>, which is what lets the read-only preview's generic
// "disable every button" lockdown correctly block it without needing its
// own special case, while the tab divs themselves stay untouched by that
// same lockdown (browsing a player's pages read-only is still fine).
function renderNotesPageTabs(editor) {
    editor = editor || document.querySelector('.notes-editor');
    const tabBar = document.querySelector('.notes-page-tabs');
    if (!tabBar) return;

    tabBar.innerHTML = '';
    notesPages.forEach((html, i) => {
        const tab = document.createElement('div');
        tab.className = 'notes-page-tab' + (i === activeNotesPageIndex ? ' active' : '');
        tab.onclick = () => switchNotesPage(i);

        const label = getFirstLineLabel(html, 'Page ' + (i + 1));
        const labelSpan = document.createElement('span');
        labelSpan.className = 'notes-page-tab-label';
        labelSpan.textContent = label;
        tab.title = label;
        tab.appendChild(labelSpan);

        if (notesPages.length > 1) {
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'notes-page-tab-close';
            closeBtn.textContent = '×';
            closeBtn.title = 'Close page';
            closeBtn.onclick = (e) => closeNotesPage(i, e);
            tab.appendChild(closeBtn);
        }

        tabBar.appendChild(tab);
    });

    if (notesPages.length < MAX_NOTES_PAGES) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'notes-page-add';
        addBtn.textContent = '+';
        addBtn.title = 'Add Page';
        addBtn.onclick = addNotesPage;
        tabBar.appendChild(addBtn);
    }
}

// Cheap live update for the ACTIVE tab only (a single element's text, not a
// full tab-bar rebuild) — safe to call on every keystroke, which is exactly
// what updateNotesPlaceholder() above does, so a page's label updates as
// you type its first line instead of only once you switch away from it.
function updateActiveTabLabel(editor) {
    editor = editor || document.querySelector('.notes-editor');
    const tabBar = document.querySelector('.notes-page-tabs');
    if (!editor || !tabBar) return;
    const activeTab = tabBar.querySelector('.notes-page-tab.active');
    const labelSpan = activeTab ? activeTab.querySelector('.notes-page-tab-label') : null;
    if (!activeTab || !labelSpan) return;
    const label = getFirstLineLabel(editor.innerHTML, 'Page ' + (activeNotesPageIndex + 1));
    labelSpan.textContent = label;
    activeTab.title = label;
}

function switchNotesPage(index) {
    const editor = document.querySelector('.notes-editor');
    if (!editor || index === activeNotesPageIndex) return;
    captureActivePageContent(editor);
    activeNotesPageIndex = index;
    loadActivePageContent(editor);
    renderNotesPageTabs(editor);
    editor.dispatchEvent(new CustomEvent('notes:changed', { bubbles: true }));
}

function addNotesPage() {
    if (notesPages.length >= MAX_NOTES_PAGES) return;
    const editor = document.querySelector('.notes-editor');
    if (editor) captureActivePageContent(editor);
    notesPages.push('');
    activeNotesPageIndex = notesPages.length - 1;
    if (editor) loadActivePageContent(editor);
    renderNotesPageTabs(editor);
    if (editor) editor.dispatchEvent(new CustomEvent('notes:changed', { bubbles: true }));
}

// Permanently removes a page — always at least one page has to remain
// (renderNotesPageTabs already hides the × entirely once only one is left,
// this is just the same guard against being called some other way). No
// capture-before-splice needed: the page being closed is being thrown away
// on purpose, and every *other* page's own array slot is untouched by
// removing a different index.
function closeNotesPage(index, event) {
    if (event) event.stopPropagation(); // don't also trigger the tab's own switch-page click
    if (notesPages.length <= 1) return;

    const label = getFirstLineLabel(notesPages[index], 'Page ' + (index + 1));
    if (!confirm(`Close "${label}"? This page's content will be lost.`)) return;

    const editor = document.querySelector('.notes-editor');
    const wasActive = index === activeNotesPageIndex;

    notesPages.splice(index, 1);

    if (index < activeNotesPageIndex) {
        activeNotesPageIndex -= 1;
    } else if (wasActive) {
        activeNotesPageIndex = Math.min(activeNotesPageIndex, notesPages.length - 1);
        if (editor) loadActivePageContent(editor);
    }
    // else: closed a later, inactive tab — the active index and the
    // editor's live content are both already correct as they are.

    renderNotesPageTabs(editor);
    if (editor) editor.dispatchEvent(new CustomEvent('notes:changed', { bubbles: true }));
}

// The one entry point pages call when loading notes back in (from a saved
// character, a campaign, the legacy-notes migration, etc.) — normalizes
// whatever was stored, resets to page 1, and renders everything.
function loadNotesPages(raw, editor) {
    editor = editor || document.querySelector('.notes-editor');
    notesPages = normalizeNotesPages(raw);
    activeNotesPageIndex = 0;
    if (editor) loadActivePageContent(editor);
    renderNotesPageTabs(editor);
}

// The one entry point pages call when saving — makes sure whatever's live
// in the editor right now (the active page) is captured back into the
// array first, then hands back a plain copy for the caller to store
// however it needs to (raw array vs JSON.stringify).
function getNotesPagesForSave(editor) {
    editor = editor || document.querySelector('.notes-editor');
    if (editor) captureActivePageContent(editor);
    return notesPages.slice();
}

// Keeps the Normal/Small/Large/Huge dropdown reading consistently with
// whichever Title level was just applied — Title 1 shows as Huge, Title 2
// as Large, Title 3 as Normal, Title 4 as Small (the same four options that
// dropdown already offers, just paired off against the four heading
// levels). Purely a display sync on the dropdown itself, not a second
// formatDoc('fontSize', ...) call — the heading's actual size already comes
// from its own CSS (h1-h4 above), so applying an inline size on top would
// just be redundant. Picking "Normal Text" isn't in this map, so the
// dropdown is left exactly as it was — that's the point at which it goes
// back to being a free, independent choice for whatever plain-paragraph
// size the DM/player actually wants.
const TITLE_TO_FONT_SIZE = { '<h1>': '7', '<h2>': '5', '<h3>': '3', '<h4>': '1' };
function syncTitleFontSize(formatBlockValue) {
    const mapped = TITLE_TO_FONT_SIZE[formatBlockValue];
    if (!mapped) return;
    const sizeSelect = document.getElementById('notesFontSizeSelect');
    if (sizeSelect) sizeSelect.value = mapped;
}

// Idempotent — safe to call as often as needed. Injects a toggle into any
// heading that doesn't already have one as its first child, so it's cheap
// insurance against any path that can create a heading: the Title dropdown
// (formatDoc calls this directly), loading saved notes back in
// (syncNotesCollapseState calls this), and anything else that might slip a
// heading in without going through either of those (paste, browser quirks
// not yet seen) — covered by calling this again on blur, deliberately NOT
// on every keystroke/oninput, so it can never interrupt someone mid-type.
function ensureHeadingToggles(editor) {
    editor = editor || document.querySelector('.notes-editor');
    if (!editor) return;
    editor.querySelectorAll('h1, h2, h3, h4').forEach(heading => {
        if (heading.firstElementChild && heading.firstElementChild.classList.contains('notes-collapse-toggle')) return;
        const toggle = document.createElement('span');
        toggle.className = 'notes-collapse-toggle';
        toggle.contentEditable = 'false';
        toggle.title = 'Collapse/expand this section';
        heading.insertBefore(toggle, heading.firstChild);
    });
}

function handleNotesEditorMousedown(e) {
    const toggle = e.target.closest('.notes-collapse-toggle');
    if (!toggle) return;
    const heading = toggle.parentElement;
    if (!heading) return;

    e.preventDefault();
    heading.classList.toggle('collapsed');
    const editor = heading.closest('.notes-editor');
    syncNotesCollapseState(editor);
    // Collapse state is saved (it's a class on the heading itself, part of
    // the same innerHTML everything else travels in), so pages that save
    // on 'notes:changed' need to hear about this too.
    editor.dispatchEvent(new CustomEvent('notes:changed', { bubbles: true }));
}

// Hides every block between `heading` and the next heading of equal-or-
// higher rank (a collapsed Title 1 swallows everything down to the next
// Title 1, including any Title 2/3/4 sections nested inside it).
function hideFollowingContent(heading) {
    const level = HEADING_LEVELS[heading.tagName];
    let node = heading.nextElementSibling;
    while (node) {
        const nodeLevel = HEADING_LEVELS[node.tagName];
        if (nodeLevel !== undefined && nodeLevel <= level) break;
        node.classList.add('notes-collapsed-content');
        node = node.nextElementSibling;
    }
}

// Recomputes which blocks are hidden from scratch, in document order.
// Needed both after a click (see above) and after loading saved notes back
// in (setCharacterData / loadStoryNotes call this once they've set
// innerHTML) — collapse state persists in the saved HTML as a plain class
// on each heading, but nothing else about *which siblings* that implies is
// saved, so it has to be recalculated every time content is loaded fresh
// rather than trusted from a stale attribute.
//
// Two passes on purpose: clearing everything first, then re-adding from
// every currently-collapsed heading, avoids an order bug where processing
// a later *uncollapsed* heading would strip the hide a still-collapsed
// ancestor heading legitimately applied to that same content.
function syncNotesCollapseState(editor) {
    editor = editor || document.querySelector('.notes-editor');
    if (!editor) return;
    ensureHeadingToggles(editor);
    Array.from(editor.children).forEach(el => el.classList.remove('notes-collapsed-content'));
    Array.from(editor.children).forEach(el => {
        if (HEADING_LEVELS[el.tagName] !== undefined && el.classList.contains('collapsed')) {
            hideFollowingContent(el);
        }
    });
}

// Gates a feature behind the license/trial system. Returns true if the
// feature is allowed to proceed. Depends on a #license-lock modal existing
// in the page — both index.html and dm.html have their own copy of it.
function restrictedFeature(featureName) {
    const email = localStorage.getItem('licenseEmail');

    // 1. If they are licensed, EVERYTHING is unlocked — EXCEPT DM Tools
    // (2026-09-08, license tier split, DM-Tester only for now), which now
    // needs its OWN entitlement (licenseHasDM, set by loginLicense() from
    // verify-license's response) — a Character-Sheet-only license no
    // longer implies DM Tools access the way any license used to. Every
    // OTHER feature name is unaffected; this only ever blocks the literal
    // string 'DM Tools'.
    if (email) {
        if (featureName === 'DM Tools' && localStorage.getItem('licenseHasDM') !== 'true') {
            // A dedicated message/link here instead of the lock modal's own
            // generic "enter your email to activate" — that's meaningless
            // to someone who's ALREADY activated (for Character Sheet);
            // re-entering the same email would just re-confirm the same
            // "no DM access" result. Swaps the modal's own text in place and
            // hides the full 3-option pricing picker (#pricing-picker-wrap)
            // for a single dedicated upgrade CTA (#dm-upgrade-only-wrap)
            // instead — the other two options (fresh Character Sheet,
            // bundle) don't make sense to offer someone who already owns
            // Character Sheet access. Each page's own resetPricingOptions()
            // undoes this swap when the modal is closed, so the full picker
            // is back next time it opens for an unrelated reason.
            const lockMsg = document.getElementById('lock-message');
            if (lockMsg) lockMsg.innerHTML = "Your license covers the Character Sheet — DM Tools needs its own upgrade on top of it.";
            const pricingWrap = document.getElementById('pricing-picker-wrap');
            if (pricingWrap) pricingWrap.style.display = 'none';
            const upgradeWrap = document.getElementById('dm-upgrade-only-wrap');
            if (upgradeWrap) upgradeWrap.style.display = 'block';
            const lock = document.getElementById('license-lock');
            if (lock) lock.style.display = 'flex';
            return false;
        }
        return true;
    }

    // 2. Manage the 30-day Trial Timer
    let installDate = localStorage.getItem('app_install_date');
    if (!installDate) {
        installDate = Date.now();
        localStorage.setItem('app_install_date', installDate);
    }

    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
    const currentTime = Date.now();
    const isTrialExpired = (currentTime - installDate) > thirtyDaysInMs;

    // 3. HARD LOCK AFTER 30 DAYS
    if (isTrialExpired) {
        alert("Your 30-day trial has expired. All features are now locked. Please activate a license to continue. If you feel that this is a mistake please reach out to mailto:BrewerGameStudios@gmail.com ");
        const lock = document.getElementById('license-lock');
        if (lock) lock.style.display = 'flex';
        return false;
    }

    // 4. DURING THE 30 DAYS - only Importing/Exporting/Printing/Cloud
    // Backups/DM Tools are locked. Saving, Save As New, Submitting to a
    // DM's campaign, and everything else work freely so the trial is
    // actually usable day-to-day. (Submit to Campaign is deliberately NOT
    // in this list — per the decided access model, a player submitting to
    // a campaign should behave exactly like Saving: free during the
    // trial, blocked only by the hard lock above once the 30 days are up.
    // Creating/managing a campaign as a DM, on the other hand, is bundled
    // into the paid license the same way Cloud Backups is.)
    const lockedDuringTrial = ['Importing', 'Exporting', 'Printing', 'Cloud Backups', 'DM Tools', 'Potion Book', 'My Spellbook'];
    if (lockedDuringTrial.includes(featureName)) {
        alert(`${featureName} is locked during the trial. Activate the full version to unlock all features.`);
        const lock = document.getElementById('license-lock');
        if (lock) lock.style.display = 'flex';
        return false;
    }
    return true;
}
