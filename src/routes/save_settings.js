export async function onRequestPost({ request, env, data }) {
    const user = data.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const formData = await request.formData();
    const settings = formData.get('settings');
    await env.DB.prepare("UPDATE users SET settings = ? WHERE id = ?").bind(settings, user.id).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}
