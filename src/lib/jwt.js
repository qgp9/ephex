/**
 * 0-Dependency JWT Implementation using Web Crypto API (SubtleCrypto)
 * Supports HMAC-SHA256 (HS256) signing and verification.
 */

const base64url = {
    encode: (buf) => {
        const binstr = String.fromCharCode(...new Uint8Array(buf));
        return btoa(binstr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode: (str) => {
        const binstr = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
        const buf = new Uint8Array(binstr.length);
        for (let i = 0; i < binstr.length; i++) buf[i] = binstr.charCodeAt(i);
        return buf;
    }
};

/**
 * Sign a payload using HS256.
 * @param {object} payload - The JWT payload.
 * @param {string} secret - The secret key string.
 * @param {number} expiresInSeconds - Expiration time in seconds (default: 30 days).
 */
export async function signJWT(payload, secret, expiresInSeconds = 2592000) {
    const encoder = new TextEncoder();
    const header = { alg: 'HS256', typ: 'JWT' };
    
    // Add expiration and issued at if not present
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
        ...payload,
        iat: now,
        exp: now + expiresInSeconds
    };

    const encodedHeader = base64url.encode(encoder.encode(JSON.stringify(header)));
    const encodedPayload = base64url.encode(encoder.encode(JSON.stringify(fullPayload)));
    const data = encoder.encode(`${encodedHeader}.${encodedPayload}`);

    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, data);
    const encodedSignature = base64url.encode(signature);

    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Verify a HS256 JWT.
 * @param {string} token - The JWT string.
 * @param {string} secret - The secret key string.
 * @returns {object|null} - Decoded payload if valid, null otherwise.
 */
export async function verifyJWT(token, secret) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const encoder = new TextEncoder();
    const data = encoder.encode(`${header}.${payload}`);

    try {
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const sigBuf = base64url.decode(signature);
        const isValid = await crypto.subtle.verify('HMAC', key, sigBuf, data);

        if (!isValid) return null;

        const decodedPayload = JSON.parse(new TextDecoder().decode(base64url.decode(payload)));
        
        // Manual expiration check
        if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) {
            console.log('JWT Expired');
            return null;
        }

        return decodedPayload;
    } catch (e) {
        console.error('JWT Verification Error:', e);
        return null;
    }
}
