<?php
/**
 * Extra-email verificering
 *
 * GET ?token=TOKEN&uid=UID
 * → validerer token mod Firestore via service-account
 * → markerer emailen verified=true
 * → redirecter til appen med ?verifySuccess=1 eller ?verifyError=X
 *
 * Virker uanset hvilken enhed/browser linket åbnes fra —
 * kræver IKKE at brugeren er logget ind.
 */

$appUrl = 'https://app.sejssvejbaek-if.dk/';

$token = trim($_GET['token'] ?? '');
$uid   = trim($_GET['uid']   ?? '');

if (!$token || !$uid) {
    redirect('invalid'); exit;
}
if (!preg_match('/^[0-9a-f\-]{32,36}$/i', $token)) {
    redirect('invalid'); exit;
}

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    redirect('config'); exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

$accessToken = google_access_token($sa);
if (!$accessToken) {
    redirect('auth'); exit;
}

// ── Hent brugerdokument fra Firestore ─────────────────────────────────────────
$docUrl = "https://firestore.googleapis.com/v1/projects/{$projectId}"
        . "/databases/(default)/documents/users/{$uid}";

$raw = http_get($docUrl, $accessToken);
if (!$raw) {
    redirect('notfound'); exit;
}

$doc    = json_decode($raw, true);
$values = $doc['fields']['extraEmails']['arrayValue']['values'] ?? [];

// ── Find og opdatér matching token ────────────────────────────────────────────
$found   = false;
$updated = array_map(function ($item) use ($token, &$found) {
    $f = $item['mapValue']['fields'] ?? null;
    if ($f
        && ($f['token']['stringValue'] ?? '') === $token
        && ($f['verified']['booleanValue'] ?? true) === false) {
        $found = true;
        return ['mapValue' => ['fields' => [
            'email'    => $f['email'],
            'verified' => ['booleanValue' => true],
            'token'    => ['stringValue'  => ''],   // tømt — ikke længere nødvendigt
        ]]];
    }
    return $item;
}, $values);

if (!$found) {
    redirect('expired'); exit;
}

// ── Skriv opdateret dokument tilbage ──────────────────────────────────────────
$body = json_encode(['fields' => [
    'extraEmails' => ['arrayValue' => ['values' => $updated]],
]]);

$resp = http_patch($docUrl . '?updateMask.fieldPaths=extraEmails', $accessToken, $body);
if (!$resp) {
    redirect('update'); exit;
}

redirect_success();

// ── Helpers ───────────────────────────────────────────────────────────────────

function redirect(string $error): void {
    global $appUrl;
    header('Location: ' . $appUrl . '?verifyError=' . $error);
    exit;
}

function redirect_success(): void {
    global $appUrl;
    header('Location: ' . $appUrl . '?verifySuccess=1');
    exit;
}

function google_access_token(array $sa): string {
    $now    = time();
    $header = b64u(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claims = b64u(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/datastore',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ]));
    $unsigned = "$header.$claims";
    openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt = "$unsigned." . b64u($sig);

    $resp = http_post_form('https://oauth2.googleapis.com/token', [
        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion'  => $jwt,
    ]);
    return json_decode($resp, true)['access_token'] ?? '';
}

function b64u(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function http_get(string $url, string $token): string {
    $ctx = stream_context_create(['http' => [
        'header'  => "Authorization: Bearer {$token}\r\n",
        'timeout' => 10,
        'ignore_errors' => true,
    ]]);
    return @file_get_contents($url, false, $ctx) ?: '';
}

function http_patch(string $url, string $token, string $body): string {
    $ctx = stream_context_create(['http' => [
        'method'  => 'PATCH',
        'header'  => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
        'content' => $body,
        'timeout' => 10,
        'ignore_errors' => true,
    ]]);
    return @file_get_contents($url, false, $ctx) ?: '';
}

function http_post_form(string $url, array $data): string {
    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content' => http_build_query($data),
        'timeout' => 10,
        'ignore_errors' => true,
    ]]);
    return @file_get_contents($url, false, $ctx) ?: '';
}
