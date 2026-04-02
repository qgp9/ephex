export async function onRequestPost({ request, env, data }) {
    const user = data.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const formData = await request.formData();
    const image = formData.get('image');
    if (!image) return new Response('No image provided', { status: 400 });

    const is_encrypted = formData.get('is_encrypted') === '1' ? 1 : 0;
    const userSettings = JSON.parse(user.settings || '{}');
    
    // Params with fallback to user default settings
    const max_downloads = parseInt(formData.get('max_downloads') || userSettings.downloads || '0');
    const expires_in_hours = parseInt(formData.get('expires_in_hours') || userSettings.hours || '0');
    
    const id = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''); // 64 chars
    const ext = image.name ? image.name.split('.').pop() : 'enc';
    const filename = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${is_encrypted ? 'enc' : ext}`;
    
    // Store in R2
    await env.BUCKET.put(filename, image.stream(), {
        httpMetadata: { contentType: is_encrypted ? 'application/octet-stream' : image.type }
    });

    const expires_at = expires_in_hours > 0 ? new Date(Date.now() + expires_in_hours * 3600000).toISOString() : null;

    // Store in D1
    await env.DB.prepare("INSERT INTO images (id, filename, original_name, user_id, expires_at, max_downloads, is_encrypted) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, filename, image.name || 'paste', user.id, expires_at, max_downloads, is_encrypted)
        .run();

    const url = new URL(request.url);
    const encodedName = encodeURIComponent(image.name || 'image');
    const rawUrl = `${url.origin}/api/raw/${id}/${encodedName}`;
    const viewUrl = is_encrypted ? `${url.origin}/?v=${id}` : `${url.origin}/?id=${id}`;

    return new Response(JSON.stringify({
        success: true,
        url: rawUrl,
        raw_url: rawUrl,
        view_url: viewUrl,
        id: id,
        is_encrypted: is_encrypted
    }), { headers: { 'Content-Type': 'application/json' } });
}
