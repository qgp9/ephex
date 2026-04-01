<?php
// Simple Single-File Image Host
session_start();

// ==========================================
// CONFIGURATION
// ==========================================
$INIT_ADMIN_USER = 'admin';   // 초기 어드민 아이디
$INIT_ADMIN_PASS = 'admin';   // 초기 어드민 비밀번호
// ==========================================

$DATA_DIR = __DIR__ . '/data';
$UPLOAD_DIR = __DIR__ . '/uploads';
$DB_FILE = $DATA_DIR . '/db.sqlite';

if (!is_dir($DATA_DIR)) mkdir($DATA_DIR, 0777, true);
if (!is_dir($UPLOAD_DIR)) mkdir($UPLOAD_DIR, 0777, true);

// DB Connection
$db = new PDO('sqlite:' . $DB_FILE);
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Init DB Schema
$db->exec("CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'user',
    api_token TEXT,
    settings TEXT
)");

// Dynamic Migrations for older versions
try { $db->exec("ALTER TABLE users ADD COLUMN api_token TEXT"); } catch (Exception $e) {}
try { $db->exec("ALTER TABLE users ADD COLUMN settings TEXT"); } catch (Exception $e) {}
$db->exec("UPDATE users SET api_token = hex(randomblob(16)) WHERE api_token IS NULL");

$db->exec("CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    filename TEXT,
    original_name TEXT,
    user_id INTEGER,
    expires_at DATETIME,
    max_downloads INTEGER,
    current_downloads INTEGER DEFAULT 0,
    is_encrypted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
)");

// Create default admin if no users exist
$user_count = $db->query("SELECT COUNT(*) FROM users")->fetchColumn();
if ($user_count == 0) {
    $stmt = $db->prepare("INSERT INTO users (username, password_hash, role, api_token) VALUES (?, ?, ?, ?)");
    $stmt->execute([$INIT_ADMIN_USER, password_hash($INIT_ADMIN_PASS, PASSWORD_DEFAULT), 'admin', bin2hex(random_bytes(16))]);
}

// ---------------------------------------------------------
// IMAGE SERVING & ROUTING
// ---------------------------------------------------------
$action = $_GET['action'] ?? '';

// VIEW PAGE (HTML Viewer for Encrypted files)
if (isset($_GET['v']) && empty($action)) {
    $id = preg_replace('/[^a-zA-Z0-9]/', '', $_GET['v']);
    $stmt = $db->prepare("SELECT * FROM images WHERE id = ?");
    $stmt->execute([$id]);
    $image = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$image) { http_response_code(404); die("404 Not Found"); }
    ?>
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>View Encrypted Secure Image</title>
        <style>
            body { background: #0f172a; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
            .container { text-align: center; background: rgba(30,41,59,0.8); padding: 2rem; border-radius: 12px; max-width: 90%; }
            #img-display { max-width: 100%; max-height: 80vh; border-radius: 8px; display: none; margin-top: 1rem; }
            .loader { width: 30px; height: 30px; border: 3px solid #333; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s infinite linear; margin: 0 auto; }
            @keyframes spin { to { transform: rotate(360deg); } }
            .error { color: #ef4444; margin-top: 1rem; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2 id="status">Decrypting image locally...</h2>
            <div id="loader" class="loader"></div>
            <img id="img-display" alt="Decrypted Image">
            <div id="error" class="error"></div>
        </div>
        <script>
            const CryptoUtils = {
                base64ToArrayBuffer(base64) {
                    const binary_string = window.atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
                    const len = binary_string.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) { bytes[i] = binary_string.charCodeAt(i); }
                    return bytes.buffer;
                },
                async decryptFile(encryptedBlob, keyBase64) {
                    try {
                        const rawKey = this.base64ToArrayBuffer(keyBase64);
                        const key = await window.crypto.subtle.importKey(
                            "raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]
                        );
                        const arrayBuffer = await encryptedBlob.arrayBuffer();
                        const iv = arrayBuffer.slice(0, 12);
                        const data = arrayBuffer.slice(12);
                        const decryptedBuffer = await window.crypto.subtle.decrypt(
                            { name: "AES-GCM", iv: new Uint8Array(iv) }, key, data
                        );
                        return new Blob([decryptedBuffer], { type: "image/png" });
                    } catch(e) { throw new Error("Decryption failed. Invalid key or corrupted data."); }
                }
            };
            async function loadAndDecrypt() {
                try {
                    const hash = window.location.hash.substring(1);
                    if (!hash) throw new Error("Decryption key missing in URL anchor (#key)");
                    const res = await fetch(`?id=<?= $id ?>`);
                    if (!res.ok) throw new Error(res.status === 404 ? "Image not found or expired" : "Failed to fetch image data");
                    const encryptedBlob = await res.blob();
                    const decryptedBlob = await CryptoUtils.decryptFile(encryptedBlob, hash);
                    const url = URL.createObjectURL(decryptedBlob);
                    const img = document.getElementById('img-display');
                    img.src = url;
                    img.style.display = 'block';
                    document.getElementById('status').style.display = 'none';
                    document.getElementById('loader').style.display = 'none';
                } catch(e) {
                    document.getElementById('loader').style.display = 'none';
                    document.getElementById('status').innerText = 'Error';
                    document.getElementById('error').innerText = e.message;
                }
            }
            loadAndDecrypt();
        </script>
    </body>
    </html>
    <?php
    exit;
}

// RAW FILE SERVING (Downloads the bytes, decrypt later if encrypted)
if (isset($_GET['id']) && empty($action)) {
    $id = preg_replace('/[^a-zA-Z0-9]/', '', $_GET['id']);
    $stmt = $db->prepare("SELECT * FROM images WHERE id = ?");
    $stmt->execute([$id]);
    $image = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$image) { http_response_code(404); die("404 Not Found"); }

    if ($image['expires_at'] && strtotime($image['expires_at']) < time()) {
        delete_image_record($db, $image);
        http_response_code(404); die("Image Expired");
    }

    if ($image['max_downloads'] > 0 && $image['current_downloads'] >= $image['max_downloads']) {
        delete_image_record($db, $image);
        http_response_code(404); die("Download Limit Reached");
    }

    $file_path = $UPLOAD_DIR . '/' . $image['filename'];
    if (!file_exists($file_path)) { http_response_code(404); die("File is missing"); }

    $db->prepare("UPDATE images SET current_downloads = current_downloads + 1 WHERE id = ?")->execute([$id]);
    
    // Check if it should be immediately deleted after this stream
    if ($image['max_downloads'] > 0 && ($image['current_downloads'] + 1) >= $image['max_downloads']) {
        register_shutdown_function(function() use ($db, $image) { delete_image_record($db, $image); });
    }

    if ($image['is_encrypted']) {
        $mime = 'application/octet-stream';
    } else {
        $ext = strtolower(pathinfo($image['filename'], PATHINFO_EXTENSION));
        $mimes = [
            'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
            'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml'
        ];
        $mime = $mimes[$ext] ?? 'application/octet-stream';
    }

    // Stabilize PHP buit-in server output
    session_write_close();
    while (ob_get_level()) ob_end_clean();

    header("Content-Type: " . $mime);
    header("Content-Length: " . filesize($file_path));
    header("Cache-Control: public, max-age=31536000"); 
    header("Access-Control-Allow-Origin: *");
    readfile($file_path);
    exit;
}

function delete_image_record($db, $image) {
    global $UPLOAD_DIR;
    $file_path = $UPLOAD_DIR . '/' . $image['filename'];
    if (file_exists($file_path)) unlink($file_path);
    $db->prepare("DELETE FROM images WHERE id = ?")->execute([$image['id']]);
}

function generateRandomString($length = 64) {
    $characters = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    $charactersLength = strlen($characters);
    $randomString = '';
    for ($i = 0; $i < $length; $i++) $randomString .= $characters[random_int(0, $charactersLength - 1)];
    return $randomString;
}

function json_response($data, $status_code = 200) {
    header('Content-Type: application/json');
    http_response_code($status_code);
    echo json_encode($data);
    exit;
}

function require_login() {
    global $db;
    $token = $_SERVER['HTTP_X_API_TOKEN'] ?? $_POST['api_token'] ?? null;
    
    if ($token) {
        $stmt = $db->prepare("SELECT * FROM users WHERE api_token = ?");
        $stmt->execute([$token]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($user) {
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['role'] = $user['role'];
            return;
        }
    }
    
    if (!isset($_SESSION['user_id'])) json_response(['error' => 'Unauthorized'], 401);
}

function require_admin() {
    require_login();
    if ($_SESSION['role'] !== 'admin') json_response(['error' => 'Forbidden'], 403);
}

// ---------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($action === 'login') {
        $username = $_POST['username'] ?? '';
        $password = $_POST['password'] ?? '';
        $stmt = $db->prepare("SELECT * FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($user && password_verify($password, $user['password_hash'])) {
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['role'] = $user['role'];
            json_response(['success' => true]);
        } else {
            json_response(['error' => 'Invalid credentials'], 401);
        }
    }
    
    if ($action === 'logout') {
        session_destroy();
        json_response(['success' => true]);
    }

    if ($action === 'change_password') {
        require_login();
        $old = $_POST['old'] ?? '';
        $new = $_POST['new'] ?? '';
        $stmt = $db->prepare("SELECT password_hash FROM users WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        if (password_verify($old, $stmt->fetchColumn())) {
            $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?")->execute([password_hash($new, PASSWORD_DEFAULT), $_SESSION['user_id']]);
            json_response(['success' => true]);
        } else json_response(['error' => 'Incorrect old password'], 400);
    }

    if ($action === 'regenerate_token') {
        require_login();
        $newToken = bin2hex(random_bytes(16));
        $db->prepare("UPDATE users SET api_token = ? WHERE id = ?")->execute([$newToken, $_SESSION['user_id']]);
        json_response(['success' => true, 'api_token' => $newToken]);
    }
    
    if ($action === 'save_settings') {
        require_login();
        $settings = $_POST['settings'] ?? '{}';
        $db->prepare("UPDATE users SET settings = ? WHERE id = ?")->execute([$settings, $_SESSION['user_id']]);
        json_response(['success' => true]);
    }

    if ($action === 'upload') {
        require_login();
        if (!isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
            json_response(['error' => 'File upload failed'], 400);
        }

        $is_encrypted = isset($_POST['is_encrypted']) && $_POST['is_encrypted'] === '1' ? 1 : 0;
        $file = $_FILES['image'];
        $ext = pathinfo($file['name'], PATHINFO_EXTENSION) ?: 'enc';

        if (!$is_encrypted) {
            $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
            if (!in_array(strtolower($ext), $allowed)) {
                 $finfo = finfo_open(FILEINFO_MIME_TYPE);
                 $mime = finfo_file($finfo, $file['tmp_name']);
                 finfo_close($finfo);
                 if (strpos($mime, 'image/') !== 0) json_response(['error' => 'Invalid file type'], 400);
                 if (empty($ext)) $ext = explode('/', $mime)[1];
            }
        } else $ext = 'enc';

        $id = generateRandomString(64);
        $filename = uniqid('img_', true) . '.' . $ext;
        $dest = $UPLOAD_DIR . '/' . $filename;
        if (!move_uploaded_file($file['tmp_name'], $dest)) json_response(['error' => 'Failed to save file'], 500);

        $stmt = $db->prepare("SELECT settings FROM users WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        $uSettings = json_decode((string)$stmt->fetchColumn(), true) ?: [];

        $max_downloads = isset($_POST['max_downloads']) ? (int)$_POST['max_downloads'] : (int)($uSettings['downloads'] ?? 0);
        $expires_in_hours = isset($_POST['expires_in_hours']) ? (int)$_POST['expires_in_hours'] : (int)($uSettings['hours'] ?? 0);
        $expires_at = $expires_in_hours > 0 ? date('Y-m-d H:i:s', time() + ($expires_in_hours * 3600)) : null;

        $stmt = $db->prepare("INSERT INTO images (id, filename, original_name, user_id, expires_at, max_downloads, is_encrypted) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $filename, $file['name'], $_SESSION['user_id'], $expires_at, $max_downloads, $is_encrypted]);

        $scheme = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http";
        $basePath = $scheme . "://" . $_SERVER['HTTP_HOST'];
        $url = $is_encrypted ? "$basePath/?v=$id" : "$basePath/?id=$id";

        json_response(['success' => true, 'url' => $url, 'id' => $id, 'is_encrypted' => $is_encrypted, 'original_name' => $file['name'], 'created_at' => date('Y-m-d H:i:s'), 'expires_at' => $expires_at, 'max_downloads' => $max_downloads]);
    }

    if ($action === 'delete_image') {
        require_login();
        $id = $_POST['id'] ?? '';
        $stmt = $db->prepare("SELECT * FROM images WHERE id = ?");
        $stmt->execute([$id]);
        $image = $stmt->fetch();
        if ($image && ($image['user_id'] == $_SESSION['user_id'] || $_SESSION['role'] === 'admin')) {
            delete_image_record($db, $image);
            json_response(['success' => true]);
        }
        json_response(['error' => 'Not found or permission denied'], 403);
    }
    
    if ($action === 'create_user') {
        require_admin();
        $username = $_POST['username'] ?? '';
        $password = $_POST['password'] ?? '';
        $role = $_POST['role'] ?? 'user';
        if (empty($username) || empty($password)) json_response(['error' => 'Missing fields'], 400);
        try {
            $stmt = $db->prepare("INSERT INTO users (username, password_hash, role, api_token) VALUES (?, ?, ?, ?)");
            $stmt->execute([$username, password_hash($password, PASSWORD_DEFAULT), $role, bin2hex(random_bytes(16))]);
            json_response(['success' => true]);
        } catch (Exception $e) { json_response(['error' => 'User creation failed (username might exist)'], 400); }
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if ($action === 'images') {
        require_login();
        if ($_SESSION['role'] === 'admin') {
            $stmt = $db->query("SELECT i.*, u.username FROM images i LEFT JOIN users u ON i.user_id = u.id ORDER BY i.created_at DESC");
        } else {
            $stmt = $db->prepare("SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC");
            $stmt->execute([$_SESSION['user_id']]);
        }
        $images = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $scheme = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http";
        $base = $scheme . "://" . $_SERVER['HTTP_HOST'];
        foreach($images as &$img) { 
            $img['url'] = $img['is_encrypted'] ? "$base/?v=" . $img['id'] . "#(Needs Key)" : "$base/?id=" . $img['id']; 
        }
        json_response(['images' => $images]);
    }
    if ($action === 'users') {
        require_admin();
        $users = $db->query("SELECT id, username, role FROM users")->fetchAll(PDO::FETCH_ASSOC);
        json_response(['users' => $users]);
    }
}

// Prepare current user state for JS
$currentUser = null;
if (isset($_SESSION['user_id'])) {
    $stmt = $db->prepare("SELECT username, role, api_token, settings FROM users WHERE id = ?");
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($user) {
        $currentUser = [
            'username' => $user['username'],
            'role' => $user['role'],
            'api_token' => $user['api_token'],
            'settings' => $user['settings'] ? json_decode($user['settings'], true) : ['hours' => 1, 'downloads' => 5, 'encrypt' => false]
        ];
    }
}

// =========================================================
// HTML / CSS / SPA Interface
// =========================================================
if (isset($_GET['action'])) exit; // End API responses
$scheme = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http";
$baseURL = $scheme . "://" . $_SERVER['HTTP_HOST'] . "/?action=upload";
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RelayX - Secure Paste & Go</title>
    <style>
        :root {
            --bg-color: #0f172a;
            --surface-color: rgba(30, 41, 59, 0.7);
            --border-color: rgba(255,255,255, 0.1);
            --text-color: #e2e8f0;
            --text-muted: #94a3b8;
            --primary: #3b82f6;
            --primary-hover: #2563eb;
            --danger: #ef4444;
            --danger-hover: #dc2626;
            --glass-blur: 16px;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
        body { background-color: var(--bg-color); background-image: radial-gradient(circle at 15% 50%, rgba(59, 130, 246, 0.15), transparent 25%), radial-gradient(circle at 85% 30%, rgba(16, 185, 129, 0.15), transparent 25%); color: var(--text-color); min-height: 100vh; display: flex; flex-direction: column; }
        header { padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); backdrop-filter: blur(var(--glass-blur)); background: rgba(15, 23, 42, 0.6); position: sticky; top: 0; z-index: 100; }
        .logo { font-size: 1.5rem; font-weight: 800; background: linear-gradient(135deg, #60a5fa, #3b82f6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        nav button { background: none; border: none; color: var(--text-color); font-size: 1rem; margin-left: 1rem; cursor: pointer; padding: 0.5rem 1rem; border-radius: 6px; transition: all 0.2s; }
        nav button:hover, nav button.active { background: var(--surface-color); color: white; }
        main { flex: 1; padding: 2rem; max-width: 1000px; margin: 0 auto; width: 100%; position: relative; }
        .view-section { display: none; margin-bottom: 2rem; }
        .view-section.active { display: block; animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .glass-panel { background: var(--surface-color); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--border-color); border-radius: 16px; padding: 2.5rem; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
        h2 { margin-bottom: 1.5rem; font-weight: 600; color: white; }
        .form-group { margin-bottom: 1.5rem; }
        .form-group label { display: block; margin-bottom: 0.5rem; color: var(--text-muted); font-size: 0.9rem; }
        input[type="text"], input[type="password"], input[type="number"], select { width: 100%; padding: 0.75rem 1rem; border-radius: 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); color: white; font-size: 1rem; outline: none; transition: border 0.2s; }
        input:focus, select:focus { border-color: var(--primary); }
        .checkbox-container { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--primary); font-weight: 600;}
        .checkbox-container input { width: auto; transform: scale(1.2); }
        button.btn { background: var(--primary); color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 500; transition: background 0.2s, transform 0.1s; }
        button.btn:hover { background: var(--primary-hover); }
        button.btn:active { transform: scale(0.98); }
        button.btn-danger { background: var(--danger); }
        button.btn-danger:hover { background: var(--danger-hover); }
        .upload-area { border: 2px dashed var(--border-color); border-radius: 12px; padding: 4rem 2rem; text-align: center; cursor: pointer; transition: all 0.3s; background: rgba(0,0,0,0.1); position: relative; overflow: hidden; }
        .upload-area:hover, .upload-area.dragover { border-color: var(--primary); background: rgba(59, 130, 246, 0.05); }
        .upload-area .icon { font-size: 3rem; margin-bottom: 1rem; opacity: 0.7; display: block; }
        .upload-area p { color: var(--text-muted); font-size: 1.1rem; }
        .upload-area .highlight { color: var(--primary); font-weight: 600; }
        #file-input { display: none; }
        .upload-options { margin-top: 1.5rem; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; align-items: center;}
        .data-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        .data-table th, .data-table td { padding: 1rem; text-align: left; border-bottom: 1px solid var(--border-color); }
        .data-table th { color: var(--text-muted); font-weight: 500; font-size: 0.9rem; }
        .data-table td { color: #fff; font-size: 0.95rem; }
        .action-link { color: var(--primary); text-decoration: none; margin-right: 1rem; cursor: pointer; }
        .action-link.delete { color: var(--danger); }
        .thumbnail-img { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; background: rgba(0,0,0,0.5); }
        #toast-container { position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%); z-index: 1000; display: flex; flex-direction: column; gap: 0.5rem; }
        .toast { background: rgba(16, 185, 129, 0.9); backdrop-filter: blur(8px); color: white; padding: 0.75rem 1.5rem; border-radius: 999px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); font-weight: 500; animation: slideUp 0.3s ease forwards, fadeOut 0.3s ease 2.7s forwards; opacity: 0; }
        .toast.error { background: rgba(239, 68, 68, 0.9); }
        @keyframes slideUp { from{opacity:0; transform:translateY(20px);} to{opacity:1; transform:translateY(0);} }
        @keyframes fadeOut { from{opacity:1;} to{opacity:0;} }
        .loader { display: none; width: 40px; height: 40px; border: 4px solid var(--border-color); border-top-color: var(--primary); border-radius: 50%; animation: spin 1s linear infinite; margin: 2rem auto; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>

<header>
    <div class="logo">✦ RelayX</div>
    <nav id="nav-menu" style="display: none;">
        <button onclick="navigate('upload')" id="nav-upload">Dashboard</button>
        <button onclick="navigate('profile')" id="nav-profile">Profile</button>
        <button onclick="navigate('admin')" id="nav-admin" style="display: none;">Admin Focus</button>
        <button onclick="logout()">Logout</button>
    </nav>
</header>

<main>
    <div id="toast-container"></div>

    <section id="sec-login" class="view-section active">
        <div class="glass-panel" style="max-width: 400px; margin: 4rem auto;">
            <h2 style="text-align: center;">Welcome Back</h2>
            <form onsubmit="handleLogin(event)">
                <div class="form-group">
                    <label>Username</label>
                    <input type="text" id="login-user" required autocomplete="username">
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" id="login-pass" required autocomplete="current-password">
                </div>
                <button type="submit" class="btn" style="width: 100%;">Sign In</button>
            </form>
        </div>
    </section>

    <section id="sec-upload" class="view-section">
        <div class="glass-panel">
            <h2>Secure Upload</h2>
            <div class="upload-area" id="drop-zone" onclick="document.getElementById('file-input').click()">
                <span class="icon">📁</span>
                <p>Click to select, drag & drop, or <span class="highlight">Cmd+V / Ctrl+V</span> to paste an image.</p>
                <input type="file" id="file-input" accept="image/*" onchange="handleFileSelect(event)">
            </div>
            
            <div class="upload-options">
                <div class="form-group" style="margin:0;">
                    <label>Expiration (Hours, 0=never)</label>
                    <input type="number" id="opt-hours" min="0" onchange="saveUserSettings()">
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Max Downloads (0=unlim)</label>
                    <input type="number" id="opt-downloads" min="0" onchange="saveUserSettings()">
                </div>
                <label class="checkbox-container">
                    <input type="checkbox" id="opt-encrypt" onchange="saveUserSettings()"> Client-Side Encrypt (Anchor)
                </label>
            </div>
            
            <div class="loader" id="upload-loader"></div>
            
            <hr style="border-color: var(--border-color); margin: 3rem 0 2rem 0;">
            <h2 style="margin-bottom: 1rem; font-size: 1.3rem;">Recent Uploads</h2>
            <div style="overflow-x:auto;">
                <table class="data-table" id="images-table">
                    <thead><tr><th>Preview</th><th>Filename</th><th>Created</th><th>Expires</th><th>Downloads</th><th>Actions</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    </section>

    <section id="sec-profile" class="view-section">
        <div class="glass-panel" style="margin-bottom: 2rem;">
            <h2>API Token</h2>
            <p style="color:var(--text-muted); margin-bottom:1rem;">Use this token to upload via CLI. Pass it via <code>X-Api-Token</code> header or <code>api_token</code> POST field.</p>
            <div style="display:flex; gap:1rem; align-items:center;">
                <input type="text" id="api-token" readonly style="flex:1;">
                <button class="btn" onclick="copyText(document.getElementById('api-token').value, 'Token Copied!')">Copy</button>
                <button class="btn btn-danger" onclick="regenerateToken()">Regenerate</button>
            </div>
            <div style="margin-top:1.5rem; background:rgba(0,0,0,0.3); padding:1rem; border-radius:8px; overflow-x:auto;">
                <code style="color:var(--text-muted); white-space:nowrap;">curl -F "image=@file.png" -F "expires_in_hours=1" -F "max_downloads=5" -H "X-Api-Token: <span id="api-token-code">...</span>" <?= $baseURL ?></code>
            </div>
        </div>

        <div class="glass-panel">
            <h2>Change Password</h2>
             <form onsubmit="handleChangePassword(event)">
                <div class="form-group">
                    <label>Current Password</label>
                    <input type="password" id="cp-old" required>
                </div>
                <div class="form-group">
                    <label>New Password</label>
                    <input type="password" id="cp-new" required minlength="4">
                </div>
                <button type="submit" class="btn">Update Password</button>
             </form>
        </div>
    </section>

    <section id="sec-admin" class="view-section">
        <div class="glass-panel" style="margin-bottom: 2rem;">
            <h2>Create New User</h2>
            <form onsubmit="handleCreateUser(event)" style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 1rem; align-items: end;">
                <div class="form-group" style="margin: 0;"><label>Username</label><input type="text" id="new-user" required></div>
                <div class="form-group" style="margin: 0;"><label>Password</label><input type="text" id="new-pass" required></div>
                <div class="form-group" style="margin: 0;"><label>Role</label><select id="new-role"><option value="user">User</option><option value="admin">Admin</option></select></div>
                <button type="submit" class="btn">Create</button>
            </form>
        </div>
        <div class="glass-panel">
            <h2>User List</h2>
            <table class="data-table" id="users-table">
                <thead><tr><th>ID</th><th>Username</th><th>Role</th></tr></thead>
                <tbody></tbody>
            </table>
        </div>
    </section>
</main>

<script>
    let userState = <?= json_encode($currentUser) ?>;
    
    // Crypto Module (Client-Side Encryption)
    const CryptoUtils = {
        arrayBufferToBase64(buffer) {
            let binary = '';
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); }
            return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        },
        async encryptFile(file) {
            const key = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
            const exportedKey = await window.crypto.subtle.exportKey("raw", key);
            const keyBase64 = this.arrayBufferToBase64(exportedKey);
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encryptedBuffer = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, await file.arrayBuffer());
            const resultBuffer = new Uint8Array(iv.length + encryptedBuffer.byteLength);
            resultBuffer.set(iv, 0); resultBuffer.set(new Uint8Array(encryptedBuffer), iv.length);
            return { encryptedBlob: new Blob([resultBuffer], { type: "application/octet-stream" }), keyBase64 };
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (userState) setupAuthenticated();
        else navigate('login');

        document.addEventListener('paste', handleGlobalPaste);
        const dropZone = document.getElementById('drop-zone');
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, preventDefaults, false));
        ['dragenter', 'dragover'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.add('dragover'), false));
        ['dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.remove('dragover'), false));
        dropZone.addEventListener('drop', (e) => {
            if(e.dataTransfer.files.length) processFile(e.dataTransfer.files[0]);
        }, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
    function showToast(msg, isError = false) {
        const c = document.getElementById('toast-container'), t = document.createElement('div');
        t.className = `toast ${isError ? 'error' : ''}`; t.innerText = msg;
        c.appendChild(t); setTimeout(() => t.remove(), 3000);
    }

    function navigate(sectionId) {
        document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
        document.getElementById('sec-' + sectionId).classList.add('active');
        const navBtn = document.getElementById('nav-' + sectionId);
        if(navBtn) navBtn.classList.add('active');
        if (sectionId === 'upload') loadImages();
        if (sectionId === 'admin') loadUsers();
        if (sectionId === 'profile') populateProfile();
    }

    function syncUIFromSettings() {
        document.getElementById('opt-hours').value = userState.settings?.hours ?? 1;
        document.getElementById('opt-downloads').value = userState.settings?.downloads ?? 5;
        document.getElementById('opt-encrypt').checked = !!userState.settings?.encrypt;
    }

    function setupAuthenticated() {
        document.getElementById('nav-menu').style.display = 'block';
        if (userState.role === 'admin') document.getElementById('nav-admin').style.display = 'inline-block';
        syncUIFromSettings();
        navigate('upload');
    }

    async function handleLogin(e) {
        e.preventDefault();
        const fd = new FormData();
        fd.append('username', document.getElementById('login-user').value);
        fd.append('password', document.getElementById('login-pass').value);
        try {
            const res = await fetch('?action=login', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.success) { window.location.reload(); }
            else showToast(data.error || "Login failed", true);
        } catch (e) { showToast("Connection error", true); }
    }

    async function logout() { await fetch('?action=logout', {method:'POST'}); location.reload(); }

    async function saveUserSettings() {
        if (!userState) return;
        userState.settings = {
            hours: document.getElementById('opt-hours').value,
            downloads: document.getElementById('opt-downloads').value,
            encrypt: document.getElementById('opt-encrypt').checked
        };
        const fd = new FormData(); fd.append('settings', JSON.stringify(userState.settings));
        await fetch('?action=save_settings', { method: 'POST', body: fd });
        showToast("Settings auto-saved");
    }

    function populateProfile() {
        document.getElementById('api-token').value = userState.api_token;
        document.getElementById('api-token-code').innerText = userState.api_token;
    }

    async function regenerateToken() {
        if(!confirm("Are you sure? Previous CLI scripts might break.")) return;
        const res = await fetch('?action=regenerate_token', { method: 'POST' });
        const data = await res.json();
        if(data.success) {
            userState.api_token = data.api_token;
            populateProfile();
            showToast("Token Regenerated!");
        }
    }

    async function handleChangePassword(e) {
        e.preventDefault();
        const fd = new FormData();
        fd.append('old', document.getElementById('cp-old').value);
        fd.append('new', document.getElementById('cp-new').value);
        const res = await fetch('?action=change_password', {method:'POST', body:fd});
        const data = await res.json();
        if(data.success) { showToast("Password updated!"); e.target.reset(); }
        else showToast(data.error, true);
    }

    function handleFileSelect(e) { if(e.target.files.length) processFile(e.target.files[0]); }
    function handleGlobalPaste(e) {
        if(!document.getElementById('sec-upload').classList.contains('active')) return;
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.type.indexOf('image') === 0) { processFile(item.getAsFile()); return; }
        }
    }

    async function processFile(file) {
        if (!file.type.startsWith('image/')) return showToast("Please select an image file", true);
        document.getElementById('upload-loader').style.display = 'block';

        try {
            const isEncrypting = document.getElementById('opt-encrypt').checked;
            let uploadBlob = file, finalKey = '';
            
            if (isEncrypting) {
                const encResult = await CryptoUtils.encryptFile(file);
                uploadBlob = encResult.encryptedBlob; finalKey = encResult.keyBase64;
                showToast("Image encrypted locally");
            }

            const fd = new FormData();
            fd.append('image', uploadBlob, file.name);
            fd.append('max_downloads', document.getElementById('opt-downloads').value);
            fd.append('expires_in_hours', document.getElementById('opt-hours').value);
            fd.append('is_encrypted', isEncrypting ? '1' : '0');

            const res = await fetch('?action=upload', { method: 'POST', body: fd });
            const data = await res.json();
            
            if (data.success) {
                const finalUrl = isEncrypting ? `${data.url}#${finalKey}` : data.url;
                copyText(finalUrl, "URL Copied!");
                loadImages(); // Refresh table immediately below
            } else {
                showToast(data.error || "Upload failed", true);
            }
        } catch (e) {
            console.error(e); showToast("Upload error", true);
        } finally {
            document.getElementById('upload-loader').style.display = 'none';
        }
    }

    async function loadImages() {
        const res = await fetch('?action=images');
        const data = await res.json();
        const tbody = document.querySelector('#images-table tbody');
        tbody.innerHTML = '';
        data.images.forEach(img => {
            const dl = img.max_downloads > 0 ? `${img.current_downloads}/${img.max_downloads}` : `${img.current_downloads} (unlim)`;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><img src="${img.url.split('#')[0]}" class="thumbnail-img" /></td>
                <td><span style="color:#e2e8f0;font-size:0.8rem">${img.original_name}</span></td>
                <td>${img.created_at}</td><td>${img.expires_at || 'Never'}</td><td>${dl}</td>
                <td><span class="action-link" onclick="copyText('${img.url}', 'URL Copied!')">Copy Link</span><span class="action-link delete" onclick="deleteImage('${img.id}')">Delete</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    async function deleteImage(id) {
        if(!confirm("Are you sure?")) return;
        const fd = new FormData(); fd.append('id', id);
        const res = await fetch('?action=delete_image', {method: 'POST', body: fd});
        if((await res.json()).success) { showToast("Deleted"); loadImages(); }
    }

    function copyText(txt, msg="Copied!") { navigator.clipboard.writeText(txt).then(() => showToast(msg)); }

    async function loadUsers() {
        const res = await fetch('?action=users');
        const tbody = document.querySelector('#users-table tbody');
        tbody.innerHTML = '';
        (await res.json()).users.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${u.id}</td><td>${u.username}</td><td>${u.role}</td>`;
            tbody.appendChild(tr);
        });
    }

    async function handleCreateUser(e) {
        e.preventDefault();
        const fd = new FormData();
        fd.append('username', document.getElementById('new-user').value);
        fd.append('password', document.getElementById('new-pass').value);
        fd.append('role', document.getElementById('new-role').value);
        const res = await fetch('?action=create_user', {method:'POST', body: fd});
        const data = await res.json();
        if(data.success) { showToast("User created"); e.target.reset(); loadUsers(); }
        else showToast(data.error, true);
    }
</script>
</body>
</html>
