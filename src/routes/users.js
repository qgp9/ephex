export async function onRequestGet({ env, data }) {
    const user = data.user;
    if (!user || user.role !== 'admin') return new Response('Forbidden', { status: 403 });

    const users = (await env.DB.prepare("SELECT id, username, role FROM users").all()).results;
    return new Response(JSON.stringify({ users }), { headers: { 'Content-Type': 'application/json' } });
}
