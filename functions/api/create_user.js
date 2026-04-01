import { hashPassword } from './_utils.js';

export async function onRequestPost({ request, env, data }) {
    const user = data.user;
    if (!user || user.role !== 'admin') return new Response('Forbidden', { status: 403 });

    const formData = await request.formData();
    const username = formData.get('username');
    const password = formData.get('password');
    const role = formData.get('role') || 'user';

    if (!username || !password) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });

    try {
        const hash = await hashPassword(password);
        await env.DB.prepare("INSERT INTO users (username, password_hash, role, api_token) VALUES (?, ?, ?, ?)")
            .bind(username, hash, role, crypto.randomUUID().replace(/-/g, ''))
            .run();
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'User creation failed (exists?)' }), { status: 400 });
    }
}
