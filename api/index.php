<?php
/*
 * Customer API for the IT Import & Export site.
 *
 *   GET  api/index.php?action=session        who is signed in + CSRF token
 *   POST api/index.php?action=<name>         everything else (JSON body,
 *                                            X-CSRF-Token header required)
 *
 * Customer actions: signup, signin, signout, profile, password, forgot,
 * reset, verify_email, resend_code, my_activity, quote. Admin actions start with admin_.
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
        $phone = phone_field();
        $company = field('company', 120);
        $password = (string) (body()['password'] ?? '');

        if ($name === '') fail(422, 'Please enter your name.');
        if (!valid_email($email)) fail(422, 'Please enter a valid email address.');
        if ($phone === '') fail(422, 'Please enter your phone number.');
        if (strlen($password) < 8) fail(422, 'Your password needs 8 characters or more.');
        if (too_many('signup:' . client_ip(), 10, 3600)) fail(429, 'Too many sign-ups from here. Please try again later.');
        record_attempt('signup:' . client_ip());

        $exists = db()->prepare('SELECT 1 FROM users WHERE email = ?');
        $exists->execute([$email]);
        if ($exists->fetchColumn()) fail(409, "There's already an account with that email. Try signing in.");

        $now = time();
        db()->prepare('INSERT INTO users (role, name, email, phone, company, country, pass, created_at, last_seen, email_verified) VALUES (\'customer\', ?, ?, ?, ?, ?, ?, ?, ?, 0)')
            ->execute([$name, $email, $phone, $company, field('country', 80), password_hash($password, PASSWORD_DEFAULT), $now, $now]);
        $id = (int) db()->lastInsertId();
        // Earlier quote requests sent with this email now belong to the account.
        db()->prepare('UPDATE quotes SET user_id = ? WHERE user_id IS NULL AND email = ?')->execute([$id, $email]);
        log_activity($id, 'Created an account');

        $stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $user = $stmt->fetch();
        sign_in($user);
        $testCode = send_email_code($user);
        respond(['user' => public_user($user), 'csrf' => $_SESSION['csrf']] + ($testCode ? ['test_code' => $testCode] : []));
    }

    case 'verify_email': {
        $user = current_user();
        if (!$user) fail(401, 'Please sign in.');
        if ((int) $user['email_verified']) respond(['user' => public_user($user)]);
        $code = preg_replace('/\D/', '', field('code', 20));
        $stmt = db()->prepare('SELECT * FROM email_codes WHERE user_id = ?');
        $stmt->execute([$user['id']]);
        $row = $stmt->fetch();
        if (!$row || $row['expires_at'] < time() || $row['tries'] >= 5) {
            fail(400, 'This code has expired. Press "Send a new code".');
        }
        if (!hash_equals($row['code_hash'], hash('sha256', $user['id'] . ':' . $code))) {
            db()->prepare('UPDATE email_codes SET tries = tries + 1 WHERE user_id = ?')->execute([$user['id']]);
            $left = 4 - (int) $row['tries'];
            fail(422, $left > 0 ? "That code is not right. $left " . ($left === 1 ? 'try' : 'tries') . ' left.' : 'That code is not right. Press "Send a new code".');
        }
        db()->prepare('UPDATE users SET email_verified = 1 WHERE id = ?')->execute([$user['id']]);
        db()->prepare('DELETE FROM email_codes WHERE user_id = ?')->execute([$user['id']]);
        log_activity((int) $user['id'], 'Confirmed their email');
        respond(['user' => public_user(require_user())]);
    }

    case 'resend_code': {
        $user = current_user();
        if (!$user) fail(401, 'Please sign in.');
        if ((int) $user['email_verified']) respond(['message' => 'Your email is already confirmed.']);
        if (too_many('code:' . $user['id'], 5, 3600)) fail(429, 'Too many codes sent. Please try again in an hour.');
        record_attempt('code:' . $user['id']);
        $testCode = send_email_code($user);
        respond(['message' => 'A new code is on its way to ' . $user['email'] . '.'] + ($testCode ? ['test_code' => $testCode] : []));
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
        // The phone number (like the email) is locked once set, so someone who
        // steals the password can't take over the account's contact details.
        // The admin can still change both.
        $phone = $user['phone'] !== '' ? $user['phone'] : phone_field();
        db()->prepare('UPDATE users SET name = ?, phone = ?, company = ?, country = ?, city = ? WHERE id = ?')
            ->execute([$name, $phone, field('company', 120), field('country', 80), field('city', 80), $user['id']]);
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
        // The link arrived by email, so this also confirms the email.
        db()->prepare('UPDATE users SET pass = ?, email_verified = 1 WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $userId]);
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
        $phone = phone_field();
        $company = field('company', 120);
        $destination = field('destination', 80);
        $country = field('country', 80);
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
        db()->prepare('INSERT INTO quotes (user_id, name, company, phone, email, country, destination, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$userId, $name, $company, $phone, $email, $country, $destination, $details, time()]);
        if ($userId) log_activity($userId, 'Sent a quote request (' . $destination . ')');

        $notify = config()['notify_email'] ?? '';
        if ($notify !== '') {
            send_mail($notify, "New quote request from $name",
                "Name: $name\nCompany: $company\nCountry: $country\nPhone: $phone\nEmail: $email\nDestination: $destination\n\n$details\n\n"
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
        $current = db()->prepare("SELECT email FROM users WHERE id = ? AND role = 'customer'");
        $current->execute([$id]);
        $oldEmail = $current->fetchColumn();
        if ($oldEmail === false) fail(404, 'Customer not found.');
        // Email: keep the old one unless a new one is given ('' keeps a stand-in address for customers without email).
        $email = email_field();
        if ($email === '') $email = $oldEmail;
        elseif (!valid_email($email)) fail(422, 'That email address does not look right.');
        if ($email !== $oldEmail) {
            $taken = db()->prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?');
            $taken->execute([$email, $id]);
            if ($taken->fetchColumn()) fail(409, 'Another account already uses that email.');
        }
        db()->prepare("UPDATE users SET name = ?, email = ?, phone = ?, company = ?, country = ?, city = ? WHERE id = ? AND role = 'customer'")
            ->execute([$name, $email, phone_field(), field('company', 120), field('country', 80), field('city', 80), $id]);
        respond([]);
    }

    case 'admin_customer_create': {
        require_admin();
        $name = field('name', 100);
        $email = email_field();
        if ($name === '') fail(422, 'Please enter the customer\'s name.');
        if ($email !== '' && !valid_email($email)) fail(422, 'That email address does not look right.');
        if ($email !== '') {
            $taken = db()->prepare('SELECT 1 FROM users WHERE email = ?');
            $taken->execute([$email]);
            if ($taken->fetchColumn()) fail(409, 'A customer with that email already exists. Search for them instead.');
        }
        $now = time();
        // A random password nobody knows: the customer can set their own with "Forgot password".
        db()->prepare("INSERT INTO users (role, name, email, phone, company, country, city, pass, created_at, last_seen) VALUES ('customer', ?, ?, ?, ?, ?, ?, ?, ?, 0)")
            ->execute([$name, $email !== '' ? $email : placeholder_email(), phone_field(), field('company', 120), field('country', 80), field('city', 80),
                password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT), $now]);
        $id = (int) db()->lastInsertId();
        log_activity($id, 'Added by the admin');
        $note = text_field('note', 2000);
        if ($note !== '') db()->prepare('INSERT INTO notes (user_id, text, created_at) VALUES (?, ?, ?)')->execute([$id, $note, $now]);
        respond(['id' => $id]);
    }

    case 'admin_customer_verify': {
        require_admin();
        $id = (int) (body()['id'] ?? 0);
        $stmt = db()->prepare("UPDATE users SET email_verified = 1 WHERE id = ? AND role = 'customer'");
        $stmt->execute([$id]);
        if (!$stmt->rowCount()) fail(404, 'Customer not found.');
        db()->prepare('DELETE FROM email_codes WHERE user_id = ?')->execute([$id]);
        log_activity($id, 'Email confirmed by the admin');
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
            ->execute([$name, $email, phone_field(), $admin['id']]);
        respond(['user' => public_user(require_user())]);
    }

    // ── Admin: inventory ───────────────────────────────────────────────────

    case 'admin_items': {
        require_admin();
        $q = field('q', 100);
        $sql = 'SELECT * FROM items';
        $args = [];
        if ($q !== '') {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
            $sql .= " WHERE name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\'
                      OR make LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR chassis_no LIKE ? ESCAPE '\\' OR color LIKE ? ESCAPE '\\'";
            $args = array_fill(0, 8, $like);
        }
        $stmt = db()->prepare($sql . ' ORDER BY name COLLATE NOCASE LIMIT 1000');
        $stmt->execute($args);
        $s = db()->query('SELECT COUNT(*) AS items, COALESCE(SUM(quantity), 0) AS units,
                COALESCE(SUM(quantity * price_cents), 0) AS value,
                SUM(CASE WHEN quantity <= low_stock THEN 1 ELSE 0 END) AS low
            FROM items')->fetch();
        $categories = db()->query("SELECT DISTINCT category FROM items WHERE category <> '' ORDER BY category COLLATE NOCASE")->fetchAll(PDO::FETCH_COLUMN);
        respond([
            'items' => $stmt->fetchAll(),
            'categories' => $categories,
            'stats' => ['items' => (int) $s['items'], 'units' => (int) $s['units'], 'value_cents' => (int) $s['value'], 'low' => (int) $s['low']],
            'currency' => business()['currency'],
        ]);
    }

    case 'admin_item': {
        require_admin();
        $id = (int) (body()['id'] ?? 0);
        $stmt = db()->prepare('SELECT * FROM items WHERE id = ?');
        $stmt->execute([$id]);
        $item = $stmt->fetch();
        if (!$item) fail(404, 'Item not found.');
        $moves = db()->prepare('SELECT change, quantity_after, reason, created_at FROM stock_moves WHERE item_id = ? ORDER BY id DESC LIMIT 50');
        $moves->execute([$id]);
        respond(['item' => $item, 'moves' => $moves->fetchAll()]);
    }

    case 'admin_item_save': {
        require_admin();
        $id = (int) (body()['id'] ?? 0);
        $kind = (body()['kind'] ?? '') === 'car' ? 'car' : 'other';
        $price = money_cents(body()['price'] ?? '');
        $low = int_field('low_stock') ?? 1;
        $car = ['make' => field('make', 60), 'model' => field('model', 60), 'grade' => field('grade', 60),
            'chassis_no' => strtoupper(field('chassis_no', 40)), 'color' => field('color', 40), 'condition' => field('condition', 20)];
        $year = int_field('year');
        $km = int_field('mileage_km');
        $cc = int_field('engine_cc');
        if ($kind === 'car') {
            if ($car['make'] === '' || $car['model'] === '') fail(422, 'Enter the make and model of the car.');
            if ($year !== null && ($year < 1950 || $year > (int) date('Y') + 1)) fail(422, 'Enter a year between 1950 and ' . ((int) date('Y') + 1) . '.');
            if ($km !== null && ($km < 0 || $km > 2000000)) fail(422, 'Mileage must be between 0 and 2,000,000 km.');
            if ($cc !== null && ($cc < 0 || $cc > 20000)) fail(422, 'Engine size must be between 0 and 20,000 cc.');
            if (!in_array($car['condition'], ['', 'good', 'very_good', 'excellent'], true)) fail(422, 'Choose the condition: good, very good or excellent.');
            $name = trim(implode(' ', array_filter([$year ? (string) $year : '', $car['make'], $car['model'], $car['grade']])));
            $category = field('category', 60) ?: 'Vehicles';
        } else {
            $name = field('name', 150);
            $category = field('category', 60);
            $car = array_map(fn () => '', $car);
            $year = $km = $cc = null;
        }
        if ($name === '') fail(422, 'Give the item a name.');
        if ($price === null) fail(422, 'Enter the price as a number, for example 289000 or 1250.50.');
        if ($low < 0) fail(422, 'The low-stock level cannot be negative.');
        $cols = ['kind' => $kind, 'name' => $name, 'sku' => field('sku', 60), 'category' => $category, 'price_cents' => $price,
            'low_stock' => $low, 'notes' => text_field('notes', 2000), 'make' => $car['make'], 'model' => $car['model'],
            'grade' => $car['grade'], 'year' => $year, 'mileage_km' => $km, 'engine_cc' => $cc, 'chassis_no' => $car['chassis_no'],
            'color' => $car['color'], 'condition' => $car['condition'], 'updated_at' => time()];
        if ($car['chassis_no'] !== '') {
            $dupe = db()->prepare('SELECT name FROM items WHERE chassis_no = ? AND id <> ?');
            $dupe->execute([$car['chassis_no'], $id]);
            if ($other = $dupe->fetchColumn()) fail(409, "That chassis number is already on \"$other\".");
        }

        if ($id) {
            $set = implode(', ', array_map(fn ($c) => "\"$c\" = ?", array_keys($cols)));
            $stmt = db()->prepare("UPDATE items SET $set WHERE id = ?");
            $stmt->execute([...array_values($cols), $id]);
            if (!$stmt->rowCount()) fail(404, 'Item not found.');
            respond(['id' => $id]);
        }
        $qty = int_field('quantity') ?? 0;
        if ($qty < 0) fail(422, 'The starting quantity cannot be negative.');
        $cols['quantity'] = 0;
        $cols['created_at'] = time();
        db()->beginTransaction();
        $names = implode(', ', array_map(fn ($c) => "\"$c\"", array_keys($cols)));
        db()->prepare("INSERT INTO items ($names) VALUES (" . implode(', ', array_fill(0, count($cols), '?')) . ')')->execute(array_values($cols));
        $id = (int) db()->lastInsertId();
        if ($qty > 0) move_stock($id, $qty, 'Starting stock');
        db()->commit();
        respond(['id' => $id]);
    }

    case 'admin_item_stock': {
        require_admin();
        $id = (int) (body()['id'] ?? 0);
        $change = int_field('change');
        if (!$change) fail(422, 'Enter how many to add (for example 3) or remove (for example -2).');
        $reason = field('reason', 200);
        if ($reason === '') $reason = $change > 0 ? 'Stock added' : 'Stock removed';
        db()->beginTransaction();
        $after = move_stock($id, $change, $reason);
        db()->commit();
        respond(['quantity' => $after]);
    }

    case 'admin_item_delete': {
        require_admin();
        $stmt = db()->prepare('DELETE FROM items WHERE id = ?');
        $stmt->execute([(int) (body()['id'] ?? 0)]);
        if (!$stmt->rowCount()) fail(404, 'Item not found.');
        respond([]);
    }

    // ── Admin: invoices ────────────────────────────────────────────────────

    case 'admin_invoices': {
        require_admin();
        $q = field('q', 100);
        $status = field('status', 10);
        $where = [];
        $args = [];
        if ($q !== '') {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
            $where[] = "(number LIKE ? ESCAPE '\\' OR bill_name LIKE ? ESCAPE '\\' OR bill_company LIKE ? ESCAPE '\\' OR bill_email LIKE ? ESCAPE '\\')";
            array_push($args, $like, $like, $like, $like);
        }
        $today = date('Y-m-d');
        if ($status === 'overdue') { $where[] = "status = 'unpaid' AND due_date < ?"; $args[] = $today; }
        elseif (in_array($status, ['unpaid', 'paid', 'void'], true)) { $where[] = 'status = ?'; $args[] = $status; }
        $sql = 'SELECT id, number, user_id, bill_name, bill_company, issue_date, due_date, total_cents, status, paid_at FROM invoices'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY id DESC LIMIT 1000';
        $stmt = db()->prepare($sql);
        $stmt->execute($args);

        $stats = db()->prepare("SELECT
                COALESCE(SUM(CASE WHEN status = 'unpaid' THEN total_cents END), 0) AS owed,
                COALESCE(SUM(CASE WHEN status = 'unpaid' AND due_date < ? THEN total_cents END), 0) AS overdue,
                SUM(CASE WHEN status = 'unpaid' AND due_date < ? THEN 1 ELSE 0 END) AS overdue_count,
                COALESCE(SUM(CASE WHEN status = 'paid' AND paid_at >= ? THEN total_cents END), 0) AS paid_month,
                COUNT(*) AS total
            FROM invoices");
        $stats->execute([$today, $today, strtotime(date('Y-m-01'))]);
        $s = $stats->fetch();
        respond([
            'invoices' => $stmt->fetchAll(),
            'today' => $today,
            'stats' => [
                'owed_cents' => (int) $s['owed'],
                'overdue_cents' => (int) $s['overdue'],
                'overdue_count' => (int) $s['overdue_count'],
                'paid_month_cents' => (int) $s['paid_month'],
                'total' => (int) $s['total'],
            ],
            'currency' => business()['currency'],
        ]);
    }

    case 'admin_invoice': {
        require_admin();
        $id = (int) (body()['id'] ?? 0);
        $stmt = db()->prepare('SELECT * FROM invoices WHERE id = ?');
        $stmt->execute([$id]);
        $invoice = $stmt->fetch();
        if (!$invoice) fail(404, 'Invoice not found.');
        $lines = db()->prepare('SELECT item_id, description, qty, unit_cents, line_cents FROM invoice_lines WHERE invoice_id = ? ORDER BY id');
        $lines->execute([$id]);
        respond(['invoice' => $invoice, 'lines' => $lines->fetchAll(), 'business' => business(), 'today' => date('Y-m-d')]);
    }

    case 'admin_invoice_create': {
        require_admin();
        $customerId = (int) (body()['customer_id'] ?? 0);
        $bill = [
            'name' => field('bill_name', 120), 'company' => field('bill_company', 120),
            'email' => email_field('bill_email'), 'phone' => field('bill_phone', 40),
            'address' => text_field('bill_address', 300),
        ];
        if ($customerId) {
            $c = db()->prepare("SELECT * FROM users WHERE id = ? AND role = 'customer'");
            $c->execute([$customerId]);
            $customer = $c->fetch();
            if (!$customer) fail(404, 'Customer not found.');
            // Fill anything left blank from the customer's account.
            foreach (['name', 'company', 'email', 'phone'] as $k) {
                if ($bill[$k] === '') $bill[$k] = $customer[$k];
            }
            if (is_placeholder_email($bill['email'])) $bill['email'] = '';
            if ($bill['address'] === '') $bill['address'] = trim($customer['city'] . ($customer['city'] && $customer['country'] ? ', ' : '') . $customer['country']);
        }
        if ($bill['name'] === '') fail(422, 'Choose a customer or enter who the invoice is for.');
        if ($bill['email'] !== '' && !valid_email($bill['email'])) fail(422, 'That email address does not look right.');

        $issue = date_field('issue_date') ?: date('Y-m-d');
        $due = date_field('due_date') ?: date('Y-m-d', strtotime($issue . ' +14 days'));
        if ($due < $issue) fail(422, 'The due date cannot be before the invoice date.');
        $vat = body()['vat_rate'] ?? business()['vat_rate'];
        if (!is_numeric($vat) || $vat < 0 || $vat > 100) fail(422, 'VAT must be a percentage between 0 and 100.');
        $vat = round((float) $vat, 2);

        $rawLines = body()['lines'] ?? [];
        if (!is_array($rawLines) || !$rawLines) fail(422, 'Add at least one line to the invoice.');
        if (count($rawLines) > 100) fail(422, 'An invoice can have up to 100 lines.');
        $lines = [];
        $subtotal = 0;
        foreach (array_values($rawLines) as $i => $l) {
            $n = $i + 1;
            if (!is_array($l)) fail(422, "Line $n is not filled in properly.");
            $desc = is_string($l['description'] ?? null) ? mb_substr(trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $l['description'])), 0, 300) : '';
            $qty = is_numeric($l['qty'] ?? null) && (int) $l['qty'] == $l['qty'] ? (int) $l['qty'] : 0;
            $unit = money_cents($l['unit_price'] ?? '');
            $itemId = (int) ($l['item_id'] ?? 0) ?: null;
            if ($desc === '') fail(422, "Line $n needs a description.");
            if ($qty < 1 || $qty > 100000) fail(422, "Line $n needs a quantity of 1 or more.");
            if ($unit === null) fail(422, "Line $n needs a price, for example 1250.50.");
            $lineTotal = $qty * $unit;
            $subtotal += $lineTotal;
            $lines[] = [$itemId, $desc, $qty, $unit, $lineTotal];
        }
        $vatCents = (int) round($subtotal * $vat / 100);

        db()->beginTransaction();
        $year = substr($issue, 0, 4);
        $last = db()->prepare("SELECT number FROM invoices WHERE number LIKE ? ORDER BY id DESC LIMIT 1");
        $last->execute(["INV-$year-%"]);
        $seq = ($prev = $last->fetchColumn()) ? ((int) substr($prev, -4)) + 1 : 1;
        $number = sprintf('INV-%s-%04d', $year, $seq);

        db()->prepare('INSERT INTO invoices (number, user_id, bill_name, bill_company, bill_email, bill_phone, bill_address, issue_date, due_date, vat_rate,
                subtotal_cents, vat_cents, total_cents, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$number, $customerId ?: null, $bill['name'], $bill['company'], $bill['email'], $bill['phone'], $bill['address'],
                $issue, $due, $vat, $subtotal, $vatCents, $subtotal + $vatCents, text_field('notes', 1000), time()]);
        $invoiceId = (int) db()->lastInsertId();
        $insert = db()->prepare('INSERT INTO invoice_lines (invoice_id, item_id, description, qty, unit_cents, line_cents) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($lines as [$itemId, $desc, $qty, $unit, $lineTotal]) {
            // Items sold from inventory leave the stock.
            if ($itemId) move_stock($itemId, -$qty, "Sold on $number");
            $insert->execute([$invoiceId, $itemId, $desc, $qty, $unit, $lineTotal]);
        }
        if ($customerId) log_activity($customerId, "Invoice $number created");
        db()->commit();
        respond(['id' => $invoiceId, 'number' => $number]);
    }

    case 'admin_invoice_status': {
        require_admin();
        $id = (int) (body()['id'] ?? 0);
        $next = field('status', 10);
        if (!in_array($next, ['unpaid', 'paid', 'void'], true)) fail(422, 'Unknown status.');
        $stmt = db()->prepare('SELECT * FROM invoices WHERE id = ?');
        $stmt->execute([$id]);
        $invoice = $stmt->fetch();
        if (!$invoice) fail(404, 'Invoice not found.');
        if ($invoice['status'] === 'void') fail(422, 'This invoice was cancelled. Make a new invoice instead.');
        if ($invoice['status'] === $next) respond([]);

        db()->beginTransaction();
        if ($next === 'void') {
            // Cancelling puts sold inventory back on the shelf.
            $lines = db()->prepare('SELECT item_id, qty FROM invoice_lines WHERE invoice_id = ? AND item_id IS NOT NULL');
            $lines->execute([$id]);
            foreach ($lines->fetchAll() as $l) {
                $exists = db()->prepare('SELECT 1 FROM items WHERE id = ?');
                $exists->execute([$l['item_id']]);
                if ($exists->fetchColumn()) move_stock((int) $l['item_id'], (int) $l['qty'], "Returned: {$invoice['number']} cancelled");
            }
        }
        db()->prepare('UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?')
            ->execute([$next, $next === 'paid' ? time() : null, $id]);
        if ($invoice['user_id']) {
            log_activity((int) $invoice['user_id'], "Invoice {$invoice['number']} " . ['paid' => 'marked as paid', 'unpaid' => 'marked as unpaid', 'void' => 'cancelled'][$next]);
        }
        db()->commit();
        respond([]);
    }

    // ── Admin: invoice details (company + bank) ───────────────────────────

    case 'admin_settings': {
        require_admin();
        respond(['business' => business()]);
    }

    case 'admin_settings_save': {
        require_admin();
        $vat = body()['vat_rate'] ?? '15';
        if (!is_numeric($vat) || $vat < 0 || $vat > 100) fail(422, 'VAT must be a percentage between 0 and 100.');
        $name = field('name', 150);
        if ($name === '') fail(422, 'Enter the company name for invoices.');
        $email = email_field();
        if ($email !== '' && !valid_email($email)) fail(422, 'That email address does not look right.');
        $currency = field('currency', 8);
        if ($currency === '') fail(422, 'Enter the currency, for example N$.');
        foreach ([
            'business_name' => $name, 'business_address' => text_field('address', 400), 'business_phone' => field('phone', 60),
            'business_email' => $email, 'business_vat_number' => field('vat_number', 60), 'business_bank' => text_field('bank', 600),
            'currency' => $currency, 'default_vat_rate' => (string) round((float) $vat, 2),
        ] as $k => $v) save_setting($k, $v);
        respond([]);
    }

    // ── Clearing calculator ────────────────────────────────────────────────

    case 'calculator': {
        // Public: the rates customers use on /calculator.
        $enabled = setting('calc_enabled', '0') === '1';
        $lines = $enabled ? db()->query('SELECT label, kind, rate, amount_cents FROM calc_lines ORDER BY position, id')->fetchAll() : [];
        respond([
            'enabled' => $enabled && count($lines) > 0,
            'lines' => $lines,
            'currency' => business()['currency'],
            'rates' => json_decode(setting('calc_rates', '{}'), true) ?: (object) [],
            'note' => setting('calc_note', ''),
        ]);
    }

    case 'admin_calculator': {
        require_admin();
        respond([
            'enabled' => setting('calc_enabled', '0') === '1',
            'lines' => db()->query('SELECT label, kind, rate, amount_cents FROM calc_lines ORDER BY position, id')->fetchAll(),
            'currency' => business()['currency'],
            'rates' => json_decode(setting('calc_rates', '{}'), true) ?: (object) [],
            'note' => setting('calc_note', ''),
        ]);
    }

    case 'admin_calculator_save': {
        require_admin();
        $raw = body()['lines'] ?? [];
        if (!is_array($raw) || count($raw) > 30) fail(422, 'Add up to 30 charges.');
        $lines = [];
        foreach (array_values($raw) as $i => $l) {
            $n = $i + 1;
            $label = is_array($l) && is_string($l['label'] ?? null) ? mb_substr(trim($l['label']), 0, 120) : '';
            $kind = $l['kind'] ?? '';
            if ($label === '') fail(422, "Charge $n needs a name.");
            if (!in_array($kind, ['percent_value', 'percent_running', 'fixed'], true)) fail(422, "Charge $n: choose how it is worked out.");
            if ($kind === 'fixed') {
                $amount = money_cents($l['amount'] ?? '');
                if ($amount === null) fail(422, "Charge $n: enter the amount as a number, for example 3500.");
                $lines[] = [$label, $kind, 0, $amount];
            } else {
                $rate = $l['rate'] ?? '';
                if (!is_numeric($rate) || $rate < 0 || $rate > 1000) fail(422, "Charge $n: enter a percentage, for example 15.");
                $lines[] = [$label, $kind, round((float) $rate, 4), 0];
            }
        }
        $rates = [];
        foreach ((array) (body()['rates'] ?? []) as $code => $rate) {
            if (!in_array($code, ['USD', 'JPY', 'ZAR', 'EUR'], true)) continue;
            if ($rate === '' || $rate === null) continue;
            if (!is_numeric($rate) || $rate <= 0 || $rate > 100000) fail(422, "Enter a valid exchange rate for $code.");
            $rates[$code] = (float) $rate;
        }
        $enabled = !empty(body()['enabled']);
        if ($enabled && !$lines) fail(422, 'Add at least one charge before showing the calculator to customers.');
        db()->beginTransaction();
        db()->exec('DELETE FROM calc_lines');
        $insert = db()->prepare('INSERT INTO calc_lines (position, label, kind, rate, amount_cents) VALUES (?, ?, ?, ?, ?)');
        foreach ($lines as $i => [$label, $kind, $rate, $amount]) $insert->execute([$i, $label, $kind, $rate, $amount]);
        save_setting('calc_enabled', $enabled ? '1' : '0');
        save_setting('calc_rates', json_encode($rates));
        save_setting('calc_note', text_field('note', 600));
        db()->commit();
        respond([]);
    }

    default:
        fail(404, 'Unknown action.');
}
