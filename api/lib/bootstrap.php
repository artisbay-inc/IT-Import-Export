<?php
/*
 * Shared setup for the customer API: config, database, session, CSRF and
 * small helpers. Included by api/index.php only; this folder is not
 * reachable from the web (see api/lib/.htaccess).
 *
 * Config lives OUTSIDE public_html, at ~/itie_data/config.php on the
 * server (template: config.example.php). Locally, point ITIE_CONFIG at
 * your own copy.
 */

declare(strict_types=1);

const DAY = 86400;

function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $path = getenv('ITIE_CONFIG') ?: dirname(__DIR__, 3) . '/itie_data/config.php';
        if (!is_file($path)) {
            fail(500, 'The site is not set up yet (missing config).');
        }
        $cfg = require $path;
    }
    return $cfg;
}

// ── Responses ──────────────────────────────────────────────────────────────

function respond(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $status, string $error): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode(['ok' => false, 'error' => $error], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Database ───────────────────────────────────────────────────────────────

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $path = config()['db_path'];
    $fresh = !is_file($path);
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    if ($fresh) @chmod($path, 0600);
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            role       TEXT NOT NULL DEFAULT 'customer',
            name       TEXT NOT NULL,
            email      TEXT NOT NULL UNIQUE,
            phone      TEXT NOT NULL DEFAULT '',
            company    TEXT NOT NULL DEFAULT '',
            country    TEXT NOT NULL DEFAULT '',
            city       TEXT NOT NULL DEFAULT '',
            pass       TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_seen  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            text       TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS activity (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            text       TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS quotes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
            name        TEXT NOT NULL,
            company     TEXT NOT NULL DEFAULT '',
            phone       TEXT NOT NULL,
            email       TEXT NOT NULL,
            destination TEXT NOT NULL,
            details     TEXT NOT NULL DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'new',
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS resets (
            token_hash TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attempts (
            k  TEXT NOT NULL,
            at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attempts_k ON attempts(k, at);
        CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id, created_at);
    ");

    // First run: create the admin login from config.
    $hasAdmin = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'admin'")->fetchColumn();
    $cfg = config();
    if (!$hasAdmin && !empty($cfg['admin_email']) && !empty($cfg['admin_password_hash'])) {
        $now = time();
        $pdo->prepare("INSERT INTO users (role, name, email, pass, created_at, last_seen) VALUES ('admin', ?, ?, ?, ?, ?)")
            ->execute([$cfg['admin_name'] ?? 'Admin', strtolower($cfg['admin_email']), $cfg['admin_password_hash'], $now, $now]);
    }
}

// ── Session + CSRF ─────────────────────────────────────────────────────────

function start_session(): void
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    session_name('itie_sid');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}

function require_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) {
        fail(403, 'Your session expired. Please reload the page and try again.');
    }
}

function current_user(): ?array
{
    $id = $_SESSION['uid'] ?? null;
    if (!$id) return null;
    $stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $user = $stmt->fetch();
    if (!$user) {
        unset($_SESSION['uid']);
        return null;
    }
    return $user;
}

function require_user(): array
{
    $user = current_user();
    if (!$user) fail(401, 'Please sign in.');
    return $user;
}

function require_admin(): array
{
    $user = require_user();
    if ($user['role'] !== 'admin') fail(403, 'Admins only.');
    return $user;
}

function sign_in(array $user): void
{
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $user['id'];
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

// ── Input ──────────────────────────────────────────────────────────────────

function body(): array
{
    static $data = null;
    if ($data === null) {
        $data = json_decode(file_get_contents('php://input') ?: '[]', true);
        if (!is_array($data)) $data = [];
    }
    return $data;
}

/** A trimmed single-line string from the request body, cut to $max characters. */
function field(string $name, int $max = 200): string
{
    $value = body()[$name] ?? '';
    if (!is_string($value)) return '';
    $value = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value) ?? '');
    return mb_substr($value, 0, $max);
}

/** Multi-line text: keeps line breaks, drops other control characters. */
function text_field(string $name, int $max = 4000): string
{
    $value = body()[$name] ?? '';
    if (!is_string($value)) return '';
    $value = preg_replace('/[\x00-\x09\x0B-\x1F\x7F]+/u', '', str_replace("\r\n", "\n", $value)) ?? '';
    return mb_substr(trim($value), 0, $max);
}

function email_field(string $name = 'email'): string
{
    return strtolower(field($name, 190));
}

function valid_email(string $email): bool
{
    return (bool) filter_var($email, FILTER_VALIDATE_EMAIL);
}

// ── Rate limits ────────────────────────────────────────────────────────────

function client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function too_many(string $key, int $limit, int $window): bool
{
    $stmt = db()->prepare('SELECT COUNT(*) FROM attempts WHERE k = ? AND at > ?');
    $stmt->execute([$key, time() - $window]);
    return (int) $stmt->fetchColumn() >= $limit;
}

function record_attempt(string $key): void
{
    db()->prepare('INSERT INTO attempts (k, at) VALUES (?, ?)')->execute([$key, time()]);
    // Keep the table small.
    if (random_int(1, 50) === 1) {
        db()->prepare('DELETE FROM attempts WHERE at < ?')->execute([time() - DAY]);
    }
}

function clear_attempts(string $key): void
{
    db()->prepare('DELETE FROM attempts WHERE k = ?')->execute([$key]);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function log_activity(int $userId, string $text): void
{
    db()->prepare('INSERT INTO activity (user_id, text, created_at) VALUES (?, ?, ?)')
        ->execute([$userId, $text, time()]);
}

function touch_user(array $user): void
{
    if (time() - (int) $user['last_seen'] > 300) {
        db()->prepare('UPDATE users SET last_seen = ? WHERE id = ?')->execute([time(), $user['id']]);
    }
}

/** The fields the browser is allowed to see. Never includes the password hash. */
function public_user(array $user): array
{
    return [
        'id' => (int) $user['id'],
        'role' => $user['role'],
        'name' => $user['name'],
        'email' => $user['email'],
        'phone' => $user['phone'],
        'company' => $user['company'],
        'country' => $user['country'],
        'city' => $user['city'],
        'created_at' => (int) $user['created_at'],
        'last_seen' => (int) $user['last_seen'],
    ];
}

function send_mail(string $to, string $subject, string $body, string $replyTo = ''): bool
{
    $cfg = config();
    if (empty($cfg['mail_from']) || !valid_email($to)) return false;
    $headers = [
        'From: ' . ($cfg['mail_from_name'] ?? 'IT Import & Export') . ' <' . $cfg['mail_from'] . '>',
        'Content-Type: text/plain; charset=UTF-8',
        'MIME-Version: 1.0',
    ];
    if ($replyTo !== '' && valid_email($replyTo)) $headers[] = 'Reply-To: ' . $replyTo;
    return @mail($to, mb_encode_mimeheader($subject, 'UTF-8'), $body, implode("\r\n", $headers));
}
