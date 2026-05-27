<?php
/**
 * Conventus Login Proxy
 *
 * POST { email: string, password: string }
 * Ingen Firebase-auth påkrævet — brugeren er ikke logget ind endnu.
 *
 * Returnerer:
 *   success           → { status: 'ok', customToken, email, displayName, conventusId }
 *   multiple_profiles → { status: 'multiple_profiles', pendingToken, profiles: [{id, name}] }
 *   fejl              → HTTP 401/502 { error: '...' }
 *
 * Adgangskoden gemmes ALDRIG og logges ALDRIG.
 * UID-format: conventus_{profil_id}
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
require_once __DIR__ . '/_auth.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$input    = json_decode(file_get_contents('php://input'), true) ?: [];
$email    = trim($input['email']    ?? '');
$password = trim($input['password'] ?? '');

if (!$email || !$password || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['error' => 'Ugyldig email eller adgangskode']);
    exit;
}

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500); echo json_encode(['error' => 'Serverkonfigurationsfejl']); exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

// ── Kald Conventus login-API ──────────────────────────────────────────────────
$postData = http_build_query([
    'version'     => '2',
    'log_ind_med' => 'email',
    'email'       => $email,
    'adgangskode' => $password,
    'foreningsid' => '1031',
]);

// Adgangskode fjernes straks fra memory — bruges ikke igen
unset($password);
unset($input['password']);

$ctx = stream_context_create(['http' => [
    'method'        => 'POST',
    'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
    'content'       => $postData,
    'timeout'       => 15,
    'ignore_errors' => true,
]]);

$raw = @file_get_contents('https://www.conventus.dk/dataudv/api/medlemslogin/login.php', false, $ctx);
if ($raw === false || strlen($raw) < 5) {
    http_response_code(502);
    echo json_encode(['error' => 'Conventus svarede ikke — prøv igen om lidt']);
    exit;
}

// ── Encoding-fix (Conventus returnerer ISO-8859-1) ────────────────────────────
if (preg_match('/encoding=["\']ISO-8859-1["\']/i', $raw)) {
    $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
    $raw = preg_replace('/encoding=["\']ISO-8859-1["\']/i', 'encoding="UTF-8"', $raw);
}

$xml = @simplexml_load_string($raw, 'SimpleXMLElement', LIBXML_NOERROR | LIBXML_NOWARNING);
if ($xml === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Ugyldigt svar fra Conventus']);
    exit;
}

$status = strtolower(trim((string)($xml->status ?? $xml->resultat ?? '')));

// ── Forkerte loginoplysninger ─────────────────────────────────────────────────
if (in_array($status, ['wrong_informations', 'invalid_username', 'error'], true)) {
    http_response_code(401);
    echo json_encode(['error' => 'Forkert email eller adgangskode']);
    exit;
}

// ── Success: én profil ────────────────────────────────────────────────────────
if ($status === 'success') {
    $profileId   = trim((string)($xml->profil_id  ?? $xml->member_id ?? $xml->id   ?? ''));
    $fornavn     = trim((string)($xml->fornavn     ?? $xml->first_name ?? ''));
    $efternavn   = trim((string)($xml->efternavn   ?? $xml->last_name  ?? ''));
    $displayName = trim("$fornavn $efternavn") ?: $email;
    $memberEmail = trim((string)($xml->email ?? '')) ?: $email;

    if (!$profileId) {
        // Conventus returnerede success men ingen profil-ID
        http_response_code(502);
        echo json_encode(['error' => 'Manglende profil-ID fra Conventus']);
        exit;
    }

    $uid         = 'conventus_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $profileId);
    $customToken = make_custom_token($sa, $uid, ['conventus_id' => $profileId]);

    echo json_encode([
        'status'      => 'ok',
        'customToken' => $customToken,
        'email'       => $memberEmail,
        'displayName' => $displayName,
        'conventusId' => $profileId,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Flere profiler ────────────────────────────────────────────────────────────
if ($status === 'multiple_profiles') {
    $profiles = [];

    // Prøv forskellige XML-strukturer
    $profilNodes = $xml->profiler->profil
        ?? $xml->profiles->profile
        ?? $xml->profil
        ?? [];

    foreach ($profilNodes as $p) {
        $id        = trim((string)($p->profil_id   ?? $p->id         ?? $p->member_id ?? ''));
        $fornavn   = trim((string)($p->fornavn      ?? $p->first_name ?? ''));
        $efternavn = trim((string)($p->efternavn    ?? $p->last_name  ?? ''));
        $navn      = trim("$fornavn $efternavn") ?: "Profil $id";
        if ($id) $profiles[] = ['id' => $id, 'name' => $navn];
    }

    if (empty($profiles)) {
        http_response_code(502);
        echo json_encode(['error' => 'Conventus returnerede multiple_profiles uden profil-IDs']);
        exit;
    }

    // Gem i Firestore conventus_pending/{token} med 5-minutters udløb
    $pendingToken = bin2hex(random_bytes(24)); // 48-char hex
    $fsToken      = get_sa_token_cv($sa, 'https://www.googleapis.com/auth/datastore');
    if ($fsToken) {
        $profileValues = array_map(fn($p) => ['mapValue' => ['fields' => [
            'id'   => ['stringValue' => $p['id']],
            'name' => ['stringValue' => $p['name']],
        ]]], $profiles);

        $docBody = json_encode(['fields' => [
            'email'     => ['stringValue' => $email],
            'expiresAt' => ['integerValue' => (string)(time() + 300)],
            'profiles'  => ['arrayValue'   => ['values' => $profileValues]],
        ]]);

        $apiBase = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)";
        @file_get_contents("{$apiBase}/documents/conventus_pending/{$pendingToken}", false,
            stream_context_create(['http' => [
                'method'        => 'PATCH',
                'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
                'content'       => $docBody,
                'timeout'       => 10,
                'ignore_errors' => true,
            ]]));
    }

    echo json_encode([
        'status'       => 'multiple_profiles',
        'pendingToken' => $pendingToken,
        'profiles'     => $profiles,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Ukendt status ─────────────────────────────────────────────────────────────
http_response_code(502);
echo json_encode(['error' => 'Uventet svar fra Conventus']);

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

function b64u_cv(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function make_custom_token(array $sa, string $uid, array $claims = []): string {
    $now     = time();
    $hdr     = b64u_cv(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $payload = [
        'iss' => $sa['client_email'],
        'sub' => $sa['client_email'],
        'aud' => 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
        'iat' => $now,
        'exp' => $now + 3600,
        'uid' => $uid,
    ];
    if ($claims) $payload['claims'] = $claims;
    $pay = b64u_cv(json_encode($payload));
    openssl_sign("$hdr.$pay", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    return "$hdr.$pay." . b64u_cv($sig);
}

function get_sa_token_cv(array $sa, string $scope): string {
    $now = time();
    $h   = b64u_cv(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $p   = b64u_cv(json_encode([
        'iss' => $sa['client_email'], 'scope' => $scope,
        'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600,
    ]));
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . b64u_cv($sig);
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content'       => http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $jwt]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}
