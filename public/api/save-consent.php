<?php
/**
 * Gemmer brugersamtykke til Firestore via service account.
 * Omgår Firestore Security Rules — kræver gyldigt Firebase ID-token.
 *
 * POST { emailNotifications: bool }
 * Authorization: Bearer <Firebase ID-token>
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
require_once __DIR__ . '/_auth.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500); echo json_encode(['error' => 'Serverkonfigurationsfejl']); exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

// Verificer Firebase ID-token
$idToken = bearer_token();
if (!$idToken || !verify_firebase_id_token($idToken, $projectId)) {
    http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit;
}
$uid = uid_from_token($idToken);
if (!$uid) { http_response_code(401); echo json_encode(['error' => 'Ugyldigt token']); exit; }

$input              = json_decode(file_get_contents('php://input'), true) ?: [];
$emailNotifications = (bool)($input['emailNotifications'] ?? false);
$consentVersion     = '1.0';

// Service account access token
$fsToken = sc_access_token($sa, 'https://www.googleapis.com/auth/datastore');
if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'Token-fejl']); exit; }

// PATCH med updateMask → merge-adfærd (opretter dokumentet hvis det ikke eksisterer)
$apiBase = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)";
$docUrl  = "{$apiBase}/documents/users/{$uid}";

$fields = [
    'consentGiven'       => ['booleanValue' => true],
    'consentVersion'     => ['stringValue'  => $consentVersion],
    'consentTimestamp'   => ['timestampValue' => gmdate('Y-m-d\TH:i:s\Z')],
    'emailNotifications' => ['booleanValue' => $emailNotifications],
];

$mask = implode('&', array_map(fn($k) => "updateMask.fieldPaths=$k", array_keys($fields)));

$resp = @file_get_contents("{$docUrl}?{$mask}", false, stream_context_create(['http' => [
    'method'        => 'PATCH',
    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode(['fields' => $fields]),
    'timeout'       => 10,
    'ignore_errors' => true,
]]));

$result = json_decode($resp ?: '', true);
if (!isset($result['name'])) {
    http_response_code(500);
    echo json_encode(['error' => 'Firestore-fejl: ' . substr($resp ?: 'ingen svar', 0, 200)]);
    exit;
}

echo json_encode(['status' => 'ok']);

// ── Hjælpefunktioner ──────────────────────────────────────────────────────────

function sc_b64u(string $d): string {
    return rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
}

function sc_access_token(array $sa, string $scope): string {
    $now = time();
    $h   = sc_b64u(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $p   = sc_b64u(json_encode([
        'iss' => $sa['client_email'], 'scope' => $scope,
        'aud' => 'https://oauth2.googleapis.com/token',
        'iat' => $now, 'exp' => $now + 3600,
    ]));
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . sc_b64u($sig);
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content'       => http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $jwt]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}
