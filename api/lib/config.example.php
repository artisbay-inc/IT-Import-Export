<?php
/*
 * Copy to ~/itie_data/config.php on the server (OUTSIDE public_html) and
 * fill in. The real file is never committed.
 *
 * Make an admin password hash with:
 *   php -r "echo password_hash('your-password', PASSWORD_DEFAULT), PHP_EOL;"
 * The admin login is created from these values the first time the site runs;
 * after that, change it from the Admin page (My admin profile).
 */
return [
    // SQLite database file. Keep it next to this config, outside public_html.
    'db_path' => __DIR__ . '/site.sqlite',

    'admin_name' => 'Admin',
    'admin_email' => 'admin@example.com',
    'admin_password_hash' => '',

    // Where new quote requests are emailed. Empty = don't email, only save.
    'notify_email' => '',

    // Sender for password resets and notifications. Use an address on the
    // site's own domain so mail is less likely to land in spam.
    'mail_from' => 'no-reply@example.com',
    'mail_from_name' => 'IT Import & Export',

    // Used to build links in emails (no trailing slash).
    'site_url' => 'https://example.com',
];
