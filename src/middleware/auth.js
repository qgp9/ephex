import { verifyJWT } from "../lib/jwt.js";

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 1. Attempt to resolve identity from Cookie or API Token (Always do this)
    const cookieHeader = request.headers.get('Cookie') || '';
    const tokenCookie = cookieHeader.split('; ').find(row => row.trim().startsWith('token='));
    const token = tokenCookie ? tokenCookie.split('=')[1] : null;
    const apiToken = request.headers.get('X-Api-Token');

    if (apiToken) {
        const user = await env.DB.prepare("SELECT * FROM users WHERE api_token = ?").bind(apiToken).first();
        if (user) {
            context.data.user = user;
        }
    } else if (token) {
        try {
            const secret = env.JWT_SECRET || 'fallback_secret_for_local_dev';
            const payload = await verifyJWT(token, secret);
            if (payload) {
                context.data.user = payload;
            }
        } catch (e) {
            // Token invalid or expired, just proceed unauthenticated
        }
    }

    // 2. Allow access to public routes even if unauthenticated
    if (url.pathname === '/api/login' || url.pathname === '/api/logout' || url.pathname === '/api/profile' || url.pathname.startsWith('/api/raw/')) {
        return await context.next();
    }
    
    // 3. Block unauthorized access to protected routes
    if (!context.data.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return await context.next();
}
