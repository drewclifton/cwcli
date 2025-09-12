import fs from 'fs-extra';
import path from 'path';

export const pluginPhp = `<?php
/*
Plugin Name: CWL Local One-Click Login
Description: Local-only helper to create one-click login links via a short-lived token. Auto-installed by CLI.
Author: Local Tools
Version: 0.1
*/

add_action('init', function () {
    if (is_admin()) { return; }

    // Strictly local guard: only allow on localhost/127.0.0.1 or *.test hosts
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
    $is_local = (strpos($host, 'localhost') !== false) || (strpos($host, '127.0.0.1') !== false) || (substr($host, -5) === '.test');
    if (!$is_local) { return; }

    // Accept new param ?cwl=... and keep backward-compat for ?cwlogin=...
    $param = '';
    if (isset($_GET['cwl']) && !empty($_GET['cwl'])) { $param = 'cwl'; }
    elseif (isset($_GET['cwlogin']) && !empty($_GET['cwlogin'])) { $param = 'cwlogin'; }
    if (!$param) { return; }

    $token = sanitize_text_field($_GET[$param]);

    // Prefer new option names, fallback to old
    $opt_token = get_option('cwl_login_token');
    $opt_expires = (int) get_option('cwl_login_expires');
    if (!$opt_token || !$opt_expires) {
        $opt_token = get_option('cw_login_token');
        $opt_expires = (int) get_option('cw_login_expires');
    }
    if (!$opt_token || !$opt_expires) { return; }
    if (!hash_equals($opt_token, $token)) { return; }
    if (time() > $opt_expires) { return; }

    $user_login = isset($_GET['user']) ? sanitize_text_field($_GET['user']) : '';
    $user = null;
    if ($user_login) {
        $user = get_user_by('login', $user_login);
    }
    if (!$user) {
        // fall back to the first administrator
        $admins = get_users(array('role' => 'administrator', 'number' => 1, 'fields' => array('ID')));
        if (!empty($admins)) {
            $user = get_user_by('id', $admins[0]->ID);
        }
    }
    if (!$user) { return; }

    wp_set_current_user($user->ID);
    wp_set_auth_cookie($user->ID, true);

    // One-time use: clear tokens (both new and old)
    delete_option('cwl_login_token');
    delete_option('cwl_login_expires');
    delete_option('cw_login_token');
    delete_option('cw_login_expires');

    // Optional redirect
    $redirect = isset($_GET['redirect_to']) ? wp_unslash($_GET['redirect_to']) : '';
    if (is_string($redirect) && $redirect && substr($redirect, 0, 1) === '/') {
        wp_redirect(home_url($redirect));
    } else {
        wp_redirect(admin_url());
    }
    exit;
});
`;

export async function ensureLocalLoginMuPlugin(siteDir) {
  const wpDir = path.join(siteDir, 'wp');
  const muDir = path.join(wpDir, 'wp-content', 'mu-plugins');
    const pluginPath = path.join(muDir, 'cwl-local-login.php');
  await fs.ensureDir(muDir);
  await fs.writeFile(pluginPath, pluginPhp);
    // Clean up old filename if present
    const oldPath = path.join(muDir, 'cw-local-login.php');
    if (await fs.pathExists(oldPath)) {
        try { await fs.remove(oldPath); } catch {}
    }
  return pluginPath;
}
