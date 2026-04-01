// functions/api/logout.js
export async function onRequestPost() {
    return new Response(JSON.stringify({ success: true }), {
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax'
        }
    });
}
