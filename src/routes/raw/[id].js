export async function onRequestGet({ request, env, params }) {
    const id = params.id;
    if (!id) return new Response('Not Found', { status: 404 });

    const image = await env.DB.prepare("SELECT * FROM images WHERE id = ?").bind(id).first();
    if (!image) return new Response('Not Found', { status: 404 });
    const encryptionMode = image.encryption_mode || (image.is_encrypted ? 'symmetric' : 'plain');

    // Expiration checks
    if (image.expires_at && new Date(image.expires_at).getTime() <= Date.now()) {
        await env.DB.prepare("DELETE FROM images WHERE id = ?").bind(id).run();
        // Background delete from R2? Better to run a cron later or do it now.
        await env.BUCKET.delete(image.filename);
        return new Response('Expired', { status: 404 });
    }

    // Download limits
    if (image.max_downloads > 0 && image.current_downloads >= image.max_downloads) {
        await env.DB.prepare("DELETE FROM images WHERE id = ?").bind(id).run();
        await env.BUCKET.delete(image.filename);
        return new Response('Limit Reached', { status: 404 });
    }

    // Serving
    const object = await env.BUCKET.get(image.filename);
    if (!object) return new Response('Missing File', { status: 404 });

    await env.DB.prepare("UPDATE images SET current_downloads = current_downloads + 1 WHERE id = ?").bind(id).run();

    // Auto-delete if last download reached
    if (image.max_downloads > 0 && (image.current_downloads + 1) >= image.max_downloads) {
        // Since we've already streamed it or about to, we'll mark for deletion or delete later.
        // For simplicity, just delete metadata now.
        // Wait, Cloudflare R2 stream can be handled like this:
        const response = new Response(object.body);
        object.writeHttpMetadata(response.headers);
        response.headers.set('Access-Control-Allow-Origin', '*');
        // Actually, better to just return the response and let user download.

        // We'll delete metadata and file AFTER this response is sent?
        // CF Workers don't have register_shutdown, but we can do it after.
        // For now, let's just serve and the next access will fail.
    }

    const response = new Response(object.body);
    object.writeHttpMetadata(response.headers);
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('X-Ephex-Encryption-Mode', encryptionMode);
    if (image.encrypted_key) {
        response.headers.set('X-Ephex-Encrypted-Key', image.encrypted_key);
    }
    if (image.key_algorithm) {
        response.headers.set('X-Ephex-Key-Algorithm', image.key_algorithm);
    }
    const originalName = image.original_name || image.filename || 'image';
    const safeName = originalName.replace(/[\r\n"]/g, '_');
    const encodedName = encodeURIComponent(originalName)
        .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
        .replace(/\*/g, '%2A');
    response.headers.set('Content-Disposition', `inline; filename="${safeName}"; filename*=UTF-8''${encodedName}`);
    // Counted downloads must not be served from browser cache.
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    return response;
}
