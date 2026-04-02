export async function onRequestPost({ request, env, data }) {
    const user = data.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const formData = await request.formData();
    const id = formData.get('id');

    const image = await env.DB.prepare("SELECT * FROM images WHERE id = ?").bind(id).first();
    if (image && (image.user_id === user.id || user.role === 'admin')) {
        await env.DB.prepare("DELETE FROM images WHERE id = ?").bind(id).run();
        await env.BUCKET.delete(image.filename);
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Not found or permission denied' }), { status: 403 });
}
