<?php
/**
 * Tilknyt Google-konto til Conventus-profil
 *
 * POST  Authorization: Bearer <Google Firebase ID-token>
 *       { conventusEmail: string, conventusPassword: string }
 *
 * Returnerer:
 *   { status: 'ok', customToken, displayName, conventusId }  — ved succes
 *   HTTP 400/401/403/502 { error: '...' }                    — ved fejl
 *
 * Flow:
 * 1. Verificerer Google Firebase ID-token → udvinder verificeret Google-email
 * 2. Kalder Conventus-API med de angivne loginoplysninger
 * 3. Finder member-doc via conventusId og tjekker lederHolds
 * 4. Tilføjer Google-email til members/{conventusId}.allEmails
 * 5. Returnerer Conventus custom-token til automatisk login
 *
 * Adgangskoden gemmes ALDRIG og logges ALDRIG.
 */

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

// ── Verificér Google Firebase ID-token ────────────────────────────────────────
$idToken = bearer_token();
if (!$idToken) { http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit; }

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) { http_response_code(500); echo json_encode(['error' => 'Konfigurationsfejl']); exit; }
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

if (!verify_firebase_id_token($idToken, $projectId)) {
    http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit;
}

$payload       = decode_token_payload($idToken);
$googleEmail   = strtolower(trim((string)($payload['email'] ?? '')));
$emailVerified = (bool)($payload['email_verified'] ?? false);

if (!$googleEmail || !$emailVerified) {
    http_response_code(400);
    echo json_encode(['error' => 'Google-konto har ingen verificeret email']);
    exit;
}

// ── Hent og validér Conventus-loginoplysninger ────────────────────────────────
$body             = json_decode(file_get_contents('php://input'), true) ?? [];
$conventusEmail   = trim((string)($body['conventusEmail']   ?? ''));
$conventusPassword = trim((string)($body['conventusPassword'] ?? ''));

if (!$conventusEmail || !$conventusPassword) {
    http_response_code(400);
    echo json_encode(['error' => 'Conventus-email og adgangskode er påkrævet']);
    exit;
}

// ── Kald Conventus login-API ──────────────────────────────────────────────────
$postData = http_build_query([
    'version'     => '2',
    'log_ind_med' => 'email',
    'email'       => $conventusEmail,
    'adgangskode' => $conventusPassword,
    'foreningsid' => '1031',
]);
unset($conventusPassword, $body['conventusPassword']);

$raw = @file_get_contents('https://www.conventus.dk/dataudv/api/medlemslogin/login.php', false,
    stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content'       => $postData,
        'timeout'       => 15,
        'ignore_errors' => true,
    ]]));

if ($raw === false || strlen($raw) < 5) {
    http_response_code(502);
    echo json_encode(['error' => 'Conventus svarede ikke — prøv igen om lidt']);
    exit;
}

if (!mb_check_encoding($raw, 'UTF-8')) {
    $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
}

$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(502); echo json_encode(['error' => 'Ugyldigt svar fra Conventus']); exit;
}

$result = strtolower(trim($data['result'] ?? ''));

if (in_array($result, ['wrong_informations', 'invalid_username', 'error'], true)) {
    http_response_code(401);
    echo json_encode(['error' => 'Forkert Conventus-email eller adgangskode']);
    exit;
}
if ($result === 'multiple_profiles') {
    http_response_code(400);
    echo json_encode(['error' => 'Din Conventus-konto har flere profiler. Log direkte ind med Conventus i stedet for at tilknytte.']);
    exit;
}
if ($result !== 'success') {
    http_response_code(502);
    echo json_encode(['error' => "Uventet svar fra Conventus (result: $result)"]);
    exit;
}

$profil      = $data['profil'] ?? [];
$conventusId = trim((string)($profil['id'] ?? $profil['profil_id'] ?? $profil['member_id'] ?? ''));
$displayName = trim((string)($profil['navn'] ?? $profil['name'] ?? '')) ?: $conventusEmail;

if (!$conventusId) {
    http_response_code(502);
    echo json_encode(['error' => 'Manglende profil-ID fra Conventus']);
    exit;
}

// ── Hent member-doc og verificér lederHolds ───────────────────────────────────
$fsToken = make_fs_token($sa);
if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'OAuth fejlede']); exit; }

$base    = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents";
$doc     = fs_get("{$base}/members/{$conventusId}", $fsToken);
if (!$doc) {
    http_response_code(403);
    echo json_encode(['error' => 'Ingen adgang — ikke registreret som leder i Conventus']);
    exit;
}

$lederHolds = $doc['fields']['lederHolds']['arrayValue']['values'] ?? [];
if (empty($lederHolds)) {
    http_response_code(403);
    echo json_encode(['error' => 'Ingen adgang — ikke leder på noget aktivt hold']);
    exit;
}

// ── Tilknyt Google-email til members/{conventusId}.linkedEmails ──────────────
// Vi bruger linkedEmails (ikke allEmails) så den daglige sync ikke sletter tilknytningen.
$linkedEmailsValues = $doc['fields']['linkedEmails']['arrayValue']['values'] ?? [];
$existingLinked     = array_map(fn($v) => strtolower(trim($v['stringValue'] ?? '')), $linkedEmailsValues);

if (!in_array($googleEmail, $existingLinked, true)) {
    $linkedEmailsValues[] = ['stringValue' => $googleEmail];

    $patchUrl  = "{$base}/members/{$conventusId}?updateMask.fieldPaths=linkedEmails";
    $patchResp = @file_get_contents($patchUrl, false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => [
            'linkedEmails' => ['arrayValue' => ['values' => $linkedEmailsValues]],
        ]]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));

    $patchData = json_decode($patchResp ?: '', true);
    if (!isset($patchData['name'])) {
        http_response_code(500);
        echo json_encode(['error' => 'Kunne ikke gemme e-mail-tilknytning — prøv igen']);
        exit;
    }
}

// ── Opret Firebase custom token til automatisk login ─────────────────────────
$uid         = 'conventus_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $conventusId);
$customToken = make_link_token($sa, $uid, ['conventus_id' => $conventusId]);

echo json_encode([
    'status'      => 'ok',
    'customToken' => $customToken,
    'displayName' => $displayName,
    'conventusId' => $conventusId,
], JSON_UNESCAPED_UNICODE);

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

function b64u_lk(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function make_link_token(array $sa, string $uid, array $claims = []): string {
    $now     = time();
    $h       = b64u_lk(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $payload = [
        'iss' => $sa['client_email'],
        'sub' => $sa['client_email'],
        'aud' => 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
        'iat' => $now,
        'exp' => $now + 3600,
        'uid' => $uid,
    ];
    if ($claims) $payload['claims'] = $claims;
    $p = b64u_lk(json_encode($payload));
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    return "$h.$p." . b64u_lk($sig);
}
