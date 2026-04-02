export async function onRequestGet({ data }) {
    if (!data.user) return new Response(JSON.stringify({ authenticated: false }), { headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ ...data.user, authenticated: true }), { headers: { 'Content-Type': 'application/json' } });
}
