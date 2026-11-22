<?php
/*
 * Local development only: gives `php -S` the same clean addresses as the
 * live .htaccess (/about -> about.html). Not used on the server.
 *
 *   ITIE_CONFIG=/path/to/config.php php -S 127.0.0.1:8000 router.php
 */
// Take the path by hand: parse_url() reads "//calculator" as a host name and
// returns no path, which printed a PHP warning on the page.
$uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
$raw = strtok($uri, '?') ?: '/';
$path = preg_replace('#/{2,}#', '/', $raw);
if ($path !== $raw) { // "//calculator" -> "/calculator"
    header('Location: ' . $path . substr($uri, strlen($raw)), true, 301);
    return true;
}
if ($path === '/') {
    readfile(__DIR__ . '/index.html');
    return true;
}
if (preg_match('#^/([a-z-]+)$#', $path, $m) && is_file(__DIR__ . "/{$m[1]}.html")) {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . "/{$m[1]}.html");
    return true;
}
return false; // everything else: let the built-in server handle it
