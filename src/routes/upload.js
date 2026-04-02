export async function onRequestPost({ request, env, data }) {
    const user = data.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const formData = await request.formData();
    const image = formData.get('image');
    if (!image) return new Response('No image provided', { status: 400 });

    const requestedMode = String(formData.get('encryption_mode') || '').trim();
    const encryption_mode = ['plain', 'symmetric', 'public_key'].includes(requestedMode)
        ? requestedMode
        : (formData.get('is_encrypted') === '1' ? 'symmetric' : 'plain');
    const is_encrypted = encryption_mode === 'plain' ? 0 : 1;
    const encrypted_key = formData.get('encrypted_key');
    const key_algorithm = formData.get('key_algorithm');
    const userSettings = JSON.parse(user.settings || '{}');

    if (encryption_mode === 'public_key' && !encrypted_key) {
        return new Response(JSON.stringify({ success: false, error: 'Missing wrapped encryption key' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    function parseNonNegativeFloat(value, fallback = 0) {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed) || parsed < 0) return fallback;
        return parsed;
    }
    
    // Params with fallback to user default settings
    const max_downloads = parseInt(formData.get('max_downloads') || userSettings.downloads || '0');
    const expires_in_hours = parseNonNegativeFloat(formData.get('expires_in_hours') || userSettings.hours || '0');
    
    const id = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''); // 64 chars
    const ext = image.name ? image.name.split('.').pop() : 'enc';
    const filename = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${is_encrypted ? 'enc' : ext}`;
    
    // Store in R2
    await env.BUCKET.put(filename, image.stream(), {
        httpMetadata: { contentType: is_encrypted ? 'application/octet-stream' : image.type }
    });

    const expires_at = expires_in_hours > 0 ? new Date(Date.now() + expires_in_hours * 3600000).toISOString() : null;

    // Store in D1
    await env.DB.prepare("INSERT INTO images (id, filename, original_name, user_id, expires_at, max_downloads, is_encrypted, encryption_mode, encrypted_key, key_algorithm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
            id,
            filename,
            image.name || 'paste',
            user.id,
            expires_at,
            max_downloads,
            is_encrypted,
            encryption_mode,
            encryption_mode === 'public_key' ? (encrypted_key || null) : null,
            encryption_mode === 'public_key' ? (key_algorithm || 'RSA-OAEP-256') : null
        )
        .run();

    const url = new URL(request.url);
    const rawExt = is_encrypted ? 'enc' : ext.toLowerCase();
    const rawUrl = `${url.origin}/img/${id}.${rawExt}`;
    const viewUrl = encryption_mode === 'plain'
        ? `${url.origin}/?id=${id}`
        : (encryption_mode === 'symmetric' ? `${url.origin}/?v=${id}` : '');

    return new Response(JSON.stringify({
        success: true,
        url: rawUrl,
        raw_url: rawUrl,
        view_url: viewUrl,
        id: id,
        is_encrypted: is_encrypted,
        encryption_mode
    }), { headers: { 'Content-Type': 'application/json' } });
}
