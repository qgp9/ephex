export async function onRequestPost({ env, data }) {
    const user = data.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const newToken = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare("UPDATE users SET api_token = ? WHERE id = ?").bind(newToken, user.id).run();
    return new Response(JSON.stringify({ success: true, api_token: newToken }), { headers: { 'Content-Type': 'application/json' } });
}
