export async function onRequestGet({ env, params }) {
    const id = params.id;
    if (!id) return new Response('Not Found', { status: 404 });

    const image = await env.DB.prepare("SELECT * FROM images WHERE id = ?").bind(id).first();
    if (!image) return new Response('Not Found', { status: 404 });

    if (image.expires_at && new Date(image.expires_at).getTime() <= Date.now()) {
        return new Response('Expired', { status: 404 });
    }

    if (image.max_downloads > 0 && image.current_downloads >= image.max_downloads) {
        return new Response('Limit Reached', { status: 404 });
    }

    const object = await env.BUCKET.get(image.filename);
    if (!object) return new Response('Missing File', { status: 404 });

    const response = new Response(object.body);
    object.writeHttpMetadata(response.headers);
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cache-Control', 'private, max-age=60');
    return response;
}
