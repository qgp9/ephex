import { SignJWT } from 'jose';
import { hashPassword, verifyPassword } from './_utils.js';

export async function onRequestPost({ request, env }) {
    try {
        const formData = await request.formData();
        const username = formData.get('username');
        const password = formData.get('password');

        if (!username || !password) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });

        // Handle initial setup (if no users, allow creating first admin)
        const countRes = await env.DB.prepare("SELECT COUNT(*) as c FROM users").first('c');
        const count = countRes === undefined ? 0 : countRes;
        
        if (count === 0 && username === 'admin') {
             const hash = await hashPassword(password);
             await env.DB.prepare("INSERT INTO users (username, password_hash, role, api_token) VALUES (?, ?, ?, ?)")
                .bind('admin', hash, 'admin', crypto.randomUUID().replace(/-/g, ''))
                .run();
        }

        const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
        if (user && await verifyPassword(password, user.password_hash)) {
            const secret = new TextEncoder().encode(env.JWT_SECRET || 'fallback_secret_for_local_dev');
            const token = await new SignJWT({ id: user.id, username: user.username, role: user.role })
                .setProtectedHeader({ alg: 'HS256' })
                .setIssuedAt()
                .setExpirationTime('30d')
                .sign(secret);

            return new Response(JSON.stringify({ success: true }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Set-Cookie': `token=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`
                }
            });
        }

        return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Server Error: ' + e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

