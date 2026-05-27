<?php
/**
 * Vælg én profil fra en pending Conventus multi-profil session.
 *
 * POST { pendingToken: string, profileId: string }
 * Ingen Firebase-auth påkrævet — brugeren er ikke logget ind endnu.
 *
 * Returnerer: { status: 'ok', customToken, email, displayName, conventusId }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
require_once __DIR__ . '/_auth.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$input        = json_decode(file_get_contents('php://input'), true) ?: [];
$pendingToken = trim($input['pendingToken'] ?? '');
$profileId    = trim($input['profileId']    ?? '');

if (!$pendingToken || !$profileId) {
    http_response_code(400);
    echo json_encode(['error' => 'pendingToken og profileId er påkrævet']);
    exit;
}

if (!preg_match('/^[0-9a-f]{48}$/', $pendingToken)) {
    http_response_code(400); echo json_encode(['error' => 'Ugyldigt token-format']); exit;
}

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500); echo json_encode(['error' => 'Serverkonfigurationsfejl']); exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

$fsToken = get_sa_token_sp($sa, 'https://www.googleapis.com/auth/datastore');
if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'Token-fejl']); exit; }

$apiBase = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)";
$docUrl  = "{$apiBase}/documents/conventus_pending/{$pendingToken}";

// ── Hent pending-dokument ─────────────────────────────────────────────────────
$resp = @file_get_contents($docUrl, false, stream_context_create(['http' => [
    'header'        => "Authorization: Bearer {$fsToken}\r\n",
    'timeout'       => 10,
    'ignore_errors' => true,
]]));

$data = json_decode($resp ?: '', true);
if (!isset($data['fields'])) {
    http_response_code(404); echo json_encode(['error' => 'Ugyldig eller udløbet session — log ind igen']); exit;
}

$f         = $data['fields'];
$expiresAt = (int)($f['expiresAt']['integerValue'] ?? 0);

if ($expiresAt < time()) {
    // Slet udløbet dokument
    @file_get_contents($docUrl, false, stream_context_create(['http' => [
        'method'        => 'DELETE',
        'header'        => "Authorization: Bearer {$fsToken}\r\n",
        'timeout'       => 5,
        'ignore_errors' => true,
    ]]));
    http_response_code(410); echo json_encode(['error' => 'Sessionen er udløbet — log ind igen']); exit;
}

$email    = $f['email']['stringValue'] ?? '';
$profiles = [];
foreach ($f['profiles']['arrayValue']['values'] ?? [] as $v) {
    $pf = $v['mapValue']['fields'] ?? [];
    $profiles[] = [
        'id'   => $pf['id']['stringValue']   ?? '',
        'name' => $pf['name']['stringValue'] ?? '',
    ];
}

// ── Valider og find valgt profil ──────────────────────────────────────────────
$selected = null;
foreach ($profiles as $p) {
    if ($p['id'] === $profileId) { $selected = $p; break; }
}
if (!$selected) {
    http_response_code(400); echo json_encode(['error' => 'Ugyldigt profil-ID']); exit;
}

// ── Opret Firebase custom token ───────────────────────────────────────────────
$uid         = 'conventus_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $selected['id']);
$customToken = make_custom_token_sp($sa, $uid, ['conventus_id' => $selected['id']]);

// ── Slet pending-dokument ─────────────────────────────────────────────────────
@file_get_contents($docUrl, false, stream_context_create(['http' => [
    'method'        => 'DELETE',
    'header'        => "Authorization: Bearer {$fsToken}\r\n",
    'timeout'       => 5,
    'ignore_errors' => true,
]]));

echo json_encode([
    'status'      => 'ok',
    'customToken' => $customToken,
    'email'       => $email,
    'displayName' => $selected['name'],
    'conventusId' => $selected['id'],
], JSON_UNESCAPED_UNICODE);

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

function b64u_sp(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function make_custom_token_sp(array $sa, string $uid, array $claims = []): string {
    $now     = time();
    $hdr     = b64u_sp(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $payload = [
        'iss' => $sa['client_email'],
        'sub' => $sa['client_email'],
        'aud' => 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
        'iat' => $now,
        'exp' => $now + 3600,
        'uid' => $uid,
    ];
    if ($claims) $payload['claims'] = $claims;
    $pay = b64u_sp(json_encode($payload));
    openssl_sign("$hdr.$pay", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    return "$hdr.$pay." . b64u_sp($sig);
}

function get_sa_token_sp(array $sa, string $scope): string {
    $now = time();
    $h   = b64u_sp(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $p   = b64u_sp(json_encode([
        'iss' => $sa['client_email'], 'scope' => $scope,
        'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600,
    ]));
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . b64u_sp($sig);
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content'       => http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $jwt]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}
