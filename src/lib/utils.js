
export async function hashPassword(password) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]);
    const key = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
    return btoa(String.fromCharCode(...salt)) + ":" + btoa(String.fromCharCode(...new Uint8Array(key)));
}

export async function verifyPassword(password, stored) {
    const [saltB64, hashB64] = stored.split(":");
    const salt = new Uint8Array([...atob(saltB64)].map(c => c.charCodeAt(0)));
    const hash = new Uint8Array([...atob(hashB64)].map(c => c.charCodeAt(0)));
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]);
    const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
    const derivedArr = new Uint8Array(derived);
    if (derivedArr.length !== hash.length) return false;
    for (let i = 0; i < hash.length; i++) if (derivedArr[i] !== hash[i]) return false;
    return true;
}
