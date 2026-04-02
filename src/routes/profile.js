export async function onRequestGet({ data }) {
    if (!data.user) return new Response(JSON.stringify({ authenticated: false }), { headers: { 'Content-Type': 'application/json' } });

    let settings = { hours: 1, downloads: 5, encrypt: false, decrypt_command: '' };
    if (data.user.settings) {
        try {
            settings = { ...settings, ...JSON.parse(data.user.settings) };
        } catch (e) {
            // Fall back to defaults if stored JSON is invalid.
        }
    }

    return new Response(JSON.stringify({
        id: data.user.id,
        username: data.user.username,
        role: data.user.role,
        api_token: data.user.api_token,
        settings,
        authenticated: true
    }), { headers: { 'Content-Type': 'application/json' } });
}
