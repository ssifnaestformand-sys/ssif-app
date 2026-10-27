<?php
/**
 * Træner-adgang og holddata
 *
 * POST  Authorization: Bearer <Firebase ID-token>
 *
 * Returnerer:
 *   { name, holds: [{ id, titel, afdeling? }] }  — ved adgang
 *   { error: 'no_trainer_access' }                — ikke leder på noget aktivt hold
 *
 * Adgang afgøres KUN af lederHolds i members-collection.
 * Ingen skriv til Firestore.
 */

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit;
}

set_time_limit(30);

// ── Auth ───────────────────────────────────────────────────────────────────────
$idToken = bearer_token();
if (!$idToken) { http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit; }

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) { http_response_code(500); echo json_encode(['error' => 'Konfigurationsfejl']); exit; }
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

if (!verify_firebase_id_token($idToken, $projectId)) {
    http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit;
}

// ── Udtræk identifikatorer fra token-payload ───────────────────────────────────
// Conventus-login:  email = '' (ikke sat), conventus_id = profileId (custom claim)
// Google/email-login: email = brugerens mail,  conventus_id = ''
$parts        = explode('.', $idToken);
$payload      = json_decode(base64url_dec($parts[1]), true) ?? [];
$uid             = uid_from_token($idToken);
$email_verified  = $payload['email_verified'] ?? false;
$raw_email       = strtolower(trim((string)($payload['email'] ?? '')));
$conventus_id    = trim((string)($payload['conventus_id'] ?? '')); // custom claim

if (!$uid) { http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit; }

// Brug kun mail til opslag, hvis den er bekræftet — beskytter mod mailscannere og
// misbrugte ubekræftede konti. Conventus-login har ingen mail i tokenet og er uberørt.
if ($raw_email !== '' && !$email_verified) {
    http_response_code(403);
    echo json_encode(['error' => 'email_not_verified']);
    exit;
}
$email = $email_verified ? $raw_email : '';

// ── OAuth-token til Firestore ──────────────────────────────────────────────────
$fsToken = make_fs_token($sa);
if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'OAuth fejlede']); exit; }

$base = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents";

// ── Find alle matchende member-docs ───────────────────────────────────────────
// 1. Direkte opslag på conventus_id — Conventus-login kender altid sit eget ID
// 2. Query på allEmails array-contains email — dækker Google/email-login og
//    evt. andre profiler hos samme person (flere afdelinger)
// Deduplicerer på doc-ID.

$memberDocs = []; // ['docId' => fields-array]

if ($conventus_id !== '') {
    $doc = fs_get("{$base}/members/{$conventus_id}", $fsToken);
    if ($doc) $memberDocs[$conventus_id] = $doc['fields'];
}

if ($email !== '') {
    $rows = fs_run_query($projectId, $fsToken, [
        'structuredQuery' => [
            'from'  => [['collectionId' => 'members']],
            'where' => [
                'fieldFilter' => [
                    'field' => ['fieldPath' => 'allEmails'],
                    'op'    => 'ARRAY_CONTAINS',
                    'value' => ['stringValue' => $email],
                ],
            ],
        ],
    ]);
    foreach ($rows as $row) {
        if (!isset($row['document']['fields'])) continue;
        $docId = basename($row['document']['name'] ?? '');
        if ($docId) $memberDocs[$docId] = $row['document']['fields'];
    }
}

if (empty($memberDocs)) {
    echo json_encode(['error' => 'no_trainer_access']); exit;
}

// ── Saml lederHolds fra alle docs (unik union) ────────────────────────────────
$lederHoldIds = [];
$displayName  = '';
foreach ($memberDocs as $fields) {
    if ($displayName === '') {
        $displayName = $fields['name']['stringValue'] ?? '';
    }
    foreach ($fields['lederHolds']['arrayValue']['values'] ?? [] as $v) {
        $id = (string)($v['integerValue'] ?? $v['stringValue'] ?? '');
        if ($id !== '') $lederHoldIds[$id] = true;
    }
}

if (empty($lederHoldIds)) {
    echo json_encode(['error' => 'no_trainer_access']); exit;
}

// ── Hent holds ────────────────────────────────────────────────────────────────
$holds = [];
foreach (array_keys($lederHoldIds) as $holdId) {
    $doc = fs_get("{$base}/holds/{$holdId}", $fsToken);
    if (!$doc) continue;
    $f = $doc['fields'];
    // Spring inaktive holds over (admin-sat felt)
    if (isset($f['aktiv']['booleanValue']) && $f['aktiv']['booleanValue'] === false) continue;
    $holds[] = [
        'id'       => $holdId,
        'titel'    => $f['titel']['stringValue'] ?? "Hold {$holdId}",
        'afdeling' => $f['afdeling']['stringValue'] ?? null,
    ];
}

usort($holds, fn($a, $b) => strcoll($a['titel'], $b['titel']));

echo json_encode(['name' => $displayName, 'holds' => $holds]);


// ═══════════════════════════════════════════════════════════════════════════════

function fs_get(string $url, string $token): ?array {
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'GET',
        'header'        => "Authorization: Bearer {$token}\r\n",
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    if (!$resp) return null;
    $data = json_decode($resp, true);
    return isset($data['fields']) ? $data : null;
}

function fs_run_query(string $projectId, string $token, array $query): array {
    $url  = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:runQuery";
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode($query),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    if (!$resp) return [];
    return json_decode($resp, true) ?? [];
}

function make_fs_token(array $sa): string {
    $now = time();
    $h   = rtrim(strtr(base64_encode(json_encode(['alg' => 'RS256', 'typ' => 'JWT'])), '+/', '-_'), '=');
    $p   = rtrim(strtr(base64_encode(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/datastore',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ])), '+/', '-_'), '=');
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . rtrim(strtr(base64_encode($sig), '+/', '-_'), '=');
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content'       => http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}
