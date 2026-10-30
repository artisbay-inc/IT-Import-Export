<?php
/*
 * Customer API for the IT Import & Export site.
 *
 *   GET  api/index.php?action=session        who is signed in + CSRF token
 *   POST api/index.php?action=<name>         everything else (JSON body,
 *                                            X-CSRF-Token header required)
 *
 * Customer actions: signup, signin, signout, profile, password, forgot,
 * reset, my_activity, quote. Admin actions start with admin_.
 */

declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

start_session();

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'session' && $method === 'GET') {
    $user = current_user();
    if ($user) touch_user($user);
    respond(['user' => $user ? public_user($user) : null, 'csrf' => $_SESSION['csrf']]);
}

if ($method !== 'POST') fail(405, 'Method not allowed.');
require_csrf();

switch ($action) {

    // ── Customer: account ──────────────────────────────────────────────────

    case 'signup': {
        $name = field('name', 100);
        $email = email_field();
        $phone = field('phone', 40);
        $company = field('company', 120);
        $password = (string) (body()['password'] ?? '');

        if ($name === '') fail(422, 'Please enter your name.');
        if (!valid_email($email)) fail(422, 'Please enter a valid email address.');
        if (strlen($password) < 8) fail(422, 'Your password needs 8 characters or more.');
        if (too_many('signup:' . client_ip(), 10, 3600)) fail(429, 'Too many sign-ups from here. Please try again later.');
        record_attempt('signup:' . client_ip());

        $exists = db()->prepare('SELECT 1 FROM users WHERE email = ?');
        $exists->execute([$email]);
        if ($exists->fetchColumn()) fail(409, "There's already an account with that email. Try signing in.");

        $now = time();
        db()->prepare('INSERT INTO users (role, name, email, phone, company, pass, created_at, last_seen) VALUES (\'customer\', ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$name, $email, $phone, $company, password_hash($password, PASSWORD_DEFAULT), $now, $now]);
        $id = (int) db()->lastInsertId();
        // Earlier quote requests sent with this email now belong to the account.
        db()->prepare('UPDATE quotes SET user_id = ? WHERE user_id IS NULL AND email = ?')->execute([$id, $email]);
        log_activity($id, 'Created an account');

        $stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $user = $stmt->fetch();
        sign_in($user);
        respond(['user' => public_user($user), 'csrf' => $_SESSION['csrf']]);
    }

    case 'signin': {
        $email = email_field();
        $password = (string) (body()['password'] ?? '');
        $keyEmail = 'login:' . $email;
        $keyIp = 'login-ip:' . client_ip();
        if (too_many($keyEmail, 8, 900) || too_many($keyIp, 30, 900)) {
            fail(429, 'Too many attempts. Please wait 15 minutes and try again.');
        }

        $stmt = db()->prepare('SELECT * FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        // Check a dummy hash for unknown emails so both cases take the same time.
        $hash = $user['pass'] ?? '$2y$10$abcdefghijklmnopqrstuuJ8qmUbqU3OO/rxF7cM0x8cPbqd1qkQ6';
        if (!password_verify($password, $hash) || !$user) {
            record_attempt($keyEmail);
            record_attempt($keyIp);
            fail(401, 'That email and password do not match.');
        }
        clear_attempts($keyEmail);
        if (password_needs_rehash($user['pass'], PASSWORD_DEFAULT)) {
            db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        }
        db()->prepare('UPDATE users SET last_seen = ? WHERE id = ?')->execute([time(), $user['id']]);
        log_activity((int) $user['id'], 'Signed in');
        sign_in($user);
        respond(['user' => public_user($user), 'csrf' => $_SESSION['csrf']]);
    }

    case 'signout': {
        $_SESSION = [];
        session_regenerate_id(true);
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        respond(['csrf' => $_SESSION['csrf']]);
    }

    case 'profile': {
        $user = require_user();
        $name = field('name', 100);
        if ($name === '') fail(422, 'Please enter your name.');
        db()->prepare('UPDATE users SET name = ?, phone = ?, company = ?, country = ?, city = ? WHERE id = ?')
            ->execute([$name, field('phone', 40), field('company', 120), field('country', 80), field('city', 80), $user['id']]);
        log_activity((int) $user['id'], 'Updated their details');
        respond(['user' => public_user(require_user())]);
    }

    case 'password': {
        $user = require_user();
        $current = (string) (body()['current'] ?? '');
        $next = (string) (body()['password'] ?? '');
        if (!password_verify($current, $user['pass'])) fail(422, 'Your current password is not right.');
        if (strlen($next) < 8) fail(422, 'Your new password needs 8 characters or more.');
        db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([password_hash($next, PASSWORD_DEFAULT), $user['id']]);
        db()->prepare('DELETE FROM resets WHERE user_id = ?')->execute([$user['id']]);
        log_activity((int) $user['id'], 'Changed their password');
        sign_in($user);
        respond(['csrf' => $_SESSION['csrf']]);
    }

    case 'forgot': {
        $email = email_field();
        if (!valid_email($email)) fail(422, 'Please enter a valid email address.');
        if (too_many('forgot:' . client_ip(), 5, 3600)) fail(429, 'Too many requests. Please try again later.');
        record_attempt('forgot:' . client_ip());

        $stmt = db()->prepare('SELECT * FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        if ($user) {
            $token = bin2hex(random_bytes(32));
            db()->prepare('DELETE FROM resets WHERE user_id = ? OR expires_at < ?')->execute([$user['id'], time()]);
            db()->prepare('INSERT INTO resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
                ->execute([hash('sha256', $token), $user['id'], time() + 3600]);
            $link = rtrim(config()['site_url'], '/') . '/account#reset=' . $token;
            send_mail($user['email'], 'Reset your password',
                "Hello {$user['name']},\n\nUse this link within one hour to choose a new password:\n\n$link\n\n"
                . "If you did not ask for this, you can ignore this email.\n\nIT Import & Export CC, Walvis Bay");
        }
        // Same answer either way, so the form can't be used to find out who has an account.
        respond(['message' => 'If that email has an account, a reset link is on its way.']);
    }

    case 'reset': {
        $token = field('token', 128);
        $password = (string) (body()['password'] ?? '');
        if (strlen($password) < 8) fail(422, 'Your new password needs 8 characters or more.');
        $stmt = db()->prepare('SELECT user_id FROM resets WHERE token_hash = ? AND expires_at > ?');
        $stmt->execute([hash('sha256', $token), time()]);
        $userId = $stmt->fetchColumn();
        if (!$userId) fail(400, 'This reset link has expired or was already used. Please ask for a new one.');
        db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $userId]);
        db()->prepare('DELETE FROM resets WHERE user_id = ?')->execute([$userId]);
        log_activity((int) $userId, 'Reset their password');
        respond(['message' => 'Your password is changed. You can sign in now.']);
    }

    case 'my_activity': {
        $user = require_user();
        $quotes = db()->prepare('SELECT id, destination, details, status, created_at FROM quotes WHERE user_id = ? ORDER BY created_at DESC LIMIT 50');
        $quotes->execute([$user['id']]);
        $activity = db()->prepare('SELECT text, created_at FROM activity WHERE user_id = ? ORDER BY created_at DESC LIMIT 15');
        $activity->execute([$user['id']]);
        respond(['quotes' => $quotes->fetchAll(), 'activity' => $activity->fetchAll()]);
    }

    // ── Quote form (signed in or not) ──────────────────────────────────────

    case 'quote': {
        $name = field('name', 100);
        $email = email_field();
        $phone = field('phone', 40);
        $company = field('company', 120);
        $destination = field('destination', 80);
        $details = text_field('details', 4000);
        if ($name === '') fail(422, 'Please enter your name.');
        if ($phone === '') fail(422, 'Please enter your phone number.');
        if (!valid_email($email)) fail(422, 'Please enter a valid email address.');
        if ($destination === '') fail(422, 'Please choose a destination.');
        if (too_many('quote:' . client_ip(), 10, 3600)) fail(429, 'Too many requests from here. Please try again later.');
        record_attempt('quote:' . client_ip());

        $user = current_user();
        $userId = $user ? (int) $user['id'] : null;
        if (!$userId) {
            $match = db()->prepare("SELECT id FROM users WHERE email = ? AND role = 'customer'");
            $match->execute([$email]);
            $userId = ($id = $match->fetchColumn()) ? (int) $id : null;
        }
        db()->prepare('INSERT INTO quotes (user_id, name, company, phone, email, destination, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$userId, $name, $company, $phone, $email, $destination, $details, time()]);
        if ($userId) log_activity($userId, 'Sent a quote request (' . $destination . ')');

        $notify = config()['notify_email'] ?? '';
        if ($notify !== '') {
            send_mail($notify, "New quote request from $name",
                "Name: $name\nCompany: $company\nPhone: $phone\nEmail: $email\nDestination: $destination\n\n$details\n\n"
                . 'See all requests in the admin page: ' . rtrim(config()['site_url'], '/') . '/admin',
                $email);
        }
        respond(['message' => "Thank you. We've received your request and will reply soon."]);
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    case 'admin_customers': {
        require_admin();
        $q = field('q', 100);
        $sql = "SELECT u.* FROM users u WHERE u.role = 'customer'";
        $args = [];
        if ($q !== '') {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
            $sql .= " AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.company LIKE ? ESCAPE '\\'
                      OR EXISTS (SELECT 1 FROM notes n WHERE n.user_id = u.id AND n.text LIKE ? ESCAPE '\\'))";
            $args = array_fill(0, 5, $like);
        }
        $stmt = db()->prepare($sql . ' ORDER BY u.created_at DESC LIMIT 500');
        $stmt->execute($args);
        $customers = array_map('public_user', $stmt->fetchAll());

        $week = time() - 7 * DAY;
        $stats = db()->prepare("SELECT COUNT(*) AS total,
                SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS new_week,
                SUM(CASE WHEN last_seen > ? THEN 1 ELSE 0 END) AS active_week
            FROM users WHERE role = 'customer'");
        $stats->execute([$week, $week]);
        $s = $stats->fetch();
        $openQuotes = (int) db()->query("SELECT COUNT(*) FROM quotes WHERE status = 'new'")->fetchColumn();
        respond([
            'customers' => $customers,
            'stats' => [
                'total' => (int) $s['total'],
                'new_week' => (int) $s['new_week'],
                'active_week' => (int) $s['active_week'],
                'open_quotes' => $openQuotes,
            ],
        ]);
    }

    case 'admin_customer': {
        require_admin();
        $id = (int) (body()['id'] ?? 0);
        $stmt = db()->prepare("SELECT * FROM users WHERE id = ? AND role = 'customer'");
        $stmt->execute([$id]);
        $customer = $stmt->fetch();
        if (!$customer) fail(404, 'Customer not found.');
        $notes = db()->prepare('SELECT id, text, created_at FROM notes WHERE user_id = ? ORDER BY created_at DESC');
        $notes->execute([$id]);
        $activity = db()->prepare('SELECT text, created_at FROM activity WHERE user_id = ? ORDER BY created_at DESC LIMIT 30');
        $activity->execute([$id]);
        $quotes = db()->prepare('SELECT id, destination, details, status, created_at FROM quotes WHERE user_id = ? ORDER BY created_at DESC');
        $quotes->execute([$id]);
        respond([
            'customer' => public_user($customer),
            'notes' => $notes->fetchAll(),
            'activity' => $activity->fetchAll(),
            'quotes' => $quotes->fetchAll(),
        ]);
    }

    case 'admin_customer_update': {
        require_admin();
        $id = (int) (body()['id'] ?? 0);
        $name = field('name', 100);
        if ($name === '') fail(422, 'Name cannot be empty.');
        $stmt = db()->prepare("UPDATE users SET name = ?, phone = ?, company = ?, country = ?, city = ? WHERE id = ? AND role = 'customer'");
        $stmt->execute([$name, field('phone', 40), field('company', 120), field('country', 80), field('city', 80), $id]);
        if (!$stmt->rowCount()) fail(404, 'Customer not found.');
        respond([]);
    }

    case 'admin_customer_delete': {
        require_admin();
        $stmt = db()->prepare("DELETE FROM users WHERE id = ? AND role = 'customer'");
        $stmt->execute([(int) (body()['id'] ?? 0)]);
        if (!$stmt->rowCount()) fail(404, 'Customer not found.');
        respond([]);
    }

    case 'admin_note_add': {
        require_admin();
        $id = (int) (body()['id'] ?? 0);
        $text = text_field('text', 2000);
        if ($text === '') fail(422, 'Write a note first.');
        $exists = db()->prepare("SELECT 1 FROM users WHERE id = ? AND role = 'customer'");
        $exists->execute([$id]);
        if (!$exists->fetchColumn()) fail(404, 'Customer not found.');
        db()->prepare('INSERT INTO notes (user_id, text, created_at) VALUES (?, ?, ?)')->execute([$id, $text, time()]);
        respond([]);
    }

    case 'admin_note_delete': {
        require_admin();
        db()->prepare('DELETE FROM notes WHERE id = ?')->execute([(int) (body()['note_id'] ?? 0)]);
        respond([]);
    }

    case 'admin_quotes': {
        require_admin();
        $rows = db()->query('SELECT q.*, u.name AS account_name FROM quotes q LEFT JOIN users u ON u.id = q.user_id ORDER BY q.created_at DESC LIMIT 500')->fetchAll();
        respond(['quotes' => $rows]);
    }

    case 'admin_quote_status': {
        require_admin();
        $status = (body()['status'] ?? '') === 'done' ? 'done' : 'new';
        db()->prepare('UPDATE quotes SET status = ? WHERE id = ?')->execute([$status, (int) (body()['id'] ?? 0)]);
        respond([]);
    }

    case 'admin_profile': {
        $admin = require_admin();
        $name = field('name', 100);
        $email = email_field();
        if ($name === '') fail(422, 'Please enter your name.');
        if (!valid_email($email)) fail(422, 'Please enter a valid email address.');
        $taken = db()->prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?');
        $taken->execute([$email, $admin['id']]);
        if ($taken->fetchColumn()) fail(409, 'Another account already uses that email.');
        db()->prepare('UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?')
            ->execute([$name, $email, field('phone', 40), $admin['id']]);
        respond(['user' => public_user(require_user())]);
    }

    default:
        fail(404, 'Unknown action.');
}
