<?php
/**
 * Firebase Session Bridge
 *
 * POST med { idToken } → mintar et Firebase custom token → sætter
 * en kortlivet cookie der er tilgængelig fra både Safari og PWA på
 * samme iOS-domæne (iOS 16.4+).
 *
 * App'en kalder dette endpoint efter magic link er bekræftet i Safari,
 * så den installerede PWA kan bruge cookien til at genoptage sessionen.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

// ── Hent ID-token fra POST-body ───────────────────────────────────────────────
$input   = json_decode(file_get_contents('php://input'), true) ?: [];
$idToken = $_POST['idToken'] ?? $input['idToken'] ?? '';

if (!$idToken) {
    http_response_code(400);
    echo json_encode(['error' => 'idToken krævet']);
    exit;
}

// ── Udtræk UID og project fra JWT-payload (uden fuld signaturverifikation) ────
$parts = explode('.', $idToken);
if (count($parts) !== 3) {
    http_response_code(400);
    echo json_encode(['error' => 'Ugyldigt token-format']);
    exit;
}

$pad     = strlen($parts[1]) % 4;
$padded  = $parts[1] . ($pad ? str_repeat('=', 4 - $pad) : '');
$payload = json_decode(base64_decode(strtr($padded, '-_', '+/')), true);

$uid = $payload['sub'] ?? $payload['user_id'] ?? '';
$aud = $payload['aud'] ?? '';

if (!$uid) {
    http_response_code(400);
    echo json_encode(['error' => 'UID ikke fundet i token']);
    exit;
}

// ── Service account ───────────────────────────────────────────────────────────
$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'Service account mangler på serveren']);
    exit;
}

$sa = json_decode(file_get_contents($saPath), true);

// Grundlæggende projekttjek (aud skal matche project_id)
if (!empty($aud) && $aud !== $sa['project_id']) {
    http_response_code(400);
    echo json_encode(['error' => 'Token tilhører ikke dette projekt']);
    exit;
}

// ── Mint Firebase custom token ────────────────────────────────────────────────
$customToken = mintCustomToken($sa, $uid);

// ── Sæt kortlivet cookie (delt mellem Safari og PWA på iOS 16.4+) ────────────
setcookie('firebase-custom-token', $customToken, [
    'expires'  => time() + 300,   // 5 minutter
    'path'     => '/',
    'samesite' => 'Lax',
    'secure'   => true,
    'httponly' => false,          // Client-JS skal kunne læse den
]);

echo json_encode(['ok' => true]);

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

function base64url(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function mintCustomToken(array $sa, string $uid): string {
    $now    = time();
    $header = base64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claims = base64url(json_encode([
        'iss' => $sa['client_email'],
        'sub' => $sa['client_email'],
        'aud' => 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
        'uid' => $uid,
        'iat' => $now,
        'exp' => $now + 3600,
    ]));
    $unsigned = "$header.$claims";
    openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    return "$unsigned." . base64url($sig);
}
