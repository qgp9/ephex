import { hashPassword, verifyPassword } from "../lib/utils.js";

export async function onRequestPost({ request, env, data }) {
    const user = data.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const formData = await request.formData();
    const oldPass = formData.get('old');
    const newPass = formData.get('new');

    const dbUser = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
    if (dbUser && await verifyPassword(oldPass, dbUser.password_hash)) {
        const newHash = await hashPassword(newPass);
        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, user.id).run();
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Incorrect old password' }), { status: 400 });
}
