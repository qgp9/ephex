// functions/api/images.js
export async function onRequestGet({ request, env, data }) {
    const user = data.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    let stmt;
    if (user.role === 'admin') {
        stmt = env.DB.prepare("SELECT i.*, u.username FROM images i LEFT JOIN users u ON i.user_id = u.id ORDER BY i.created_at DESC");
    } else {
        stmt = env.DB.prepare("SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC").bind(user.id);
    }
    const images = (await stmt.all()).results;

    const url = new URL(request.url);
    const base = url.origin;

    images.forEach(img => {
        // Correcting view URLs
        img.url = img.is_encrypted ? `${base}/?v=${img.id}` : `${base}/?id=${img.id}`;
    });

    return new Response(JSON.stringify({ images }), { headers: { 'Content-Type': 'application/json' } });
}
