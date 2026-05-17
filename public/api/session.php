<?php
/**
 * Firebase Session Bridge
 *
 * POST med { idToken } → verificerer JWT-signaturen → mintar Firebase custom token
 * → sætter kortlivet cookie delt mellem Safari og PWA på iOS 16.4+.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
require_once __DIR__ . '/_auth.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

// ── Hent og verificer ID-token ────────────────────────────────────────────────
$input   = json_decode(file_get_contents('php://input'), true) ?: [];
$idToken = $_POST['idToken'] ?? $input['idToken'] ?? '';

if (!$idToken) {
    http_response_code(400); echo json_encode(['error' => 'idToken krævet']); exit;
}

// ── Service account ───────────────────────────────────────────────────────────
$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500); echo json_encode(['error' => 'Service account mangler']); exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

// ── Fuld JWT-signaturverifikation (fix C-1: forhindrer account takeover) ──────
if (!verify_firebase_id_token($idToken, $projectId)) {
    http_response_code(401); echo json_encode(['error' => 'Ugyldigt eller udløbet token']); exit;
}

$uid = uid_from_token($idToken);
if (!$uid) {
    http_response_code(400); echo json_encode(['error' => 'UID ikke fundet i token']); exit;
}

// ── Mint Firebase custom token ────────────────────────────────────────────────
$customToken = mintCustomToken($sa, $uid);

// ── Sæt kortlivet cookie (delt mellem Safari og PWA på iOS 16.4+) ────────────
setcookie('firebase-custom-token', $customToken, [
    'expires'  => time() + 300,   // 5 minutter
    'path'     => '/',
    'samesite' => 'Lax',
    'secure'   => true,
    'httponly' => false,           // Client-JS skal læse den for at signIn
]);

echo json_encode(['ok' => true]);

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

function b64u(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function mintCustomToken(array $sa, string $uid): string {
    $now    = time();
    $header = b64u(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claims = b64u(json_encode([
        'iss' => $sa['client_email'],
        'sub' => $sa['client_email'],
        'aud' => 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
        'uid' => $uid,
        'iat' => $now,
        'exp' => $now + 3600,
    ]));
    $unsigned = "$header.$claims";
    openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    return "$unsigned." . b64u($sig);
}
