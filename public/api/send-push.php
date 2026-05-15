<?php
/**
 * FCM Push Notification Sender (HTTP v1 API)
 *
 * POST params:
 *   holdIds  – JSON-array af hold-ID'er (strenge eller integers)
 *   text     – Beskedtekst
 *   title    – Overskrift (valgfri)
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

require_once __DIR__ . '/_auth.php';

// ── Autentificering via Firebase ID-token ─────────────────────────────────────
$bearerToken = bearer_token();
if (!$bearerToken) {
    http_response_code(401);
    echo json_encode(['error' => 'Uautoriseret']);
    exit;
}

$holdIds = json_decode($_POST['holdIds'] ?? '[]', true) ?: [];
$text    = trim($_POST['text']  ?? '');
$title   = trim($_POST['title'] ?? 'Ny besked fra SSIF');

if (empty($text)) {
    http_response_code(400);
    echo json_encode(['error' => 'text er påkrævet']);
    exit;
}

// ── Service account ───────────────────────────────────────────────────────────
$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'firebase-service-account.json ikke fundet']);
    exit;
}
$sa = json_decode(file_get_contents($saPath), true);
if (empty($sa['project_id']) || empty($sa['private_key']) || empty($sa['client_email'])) {
    http_response_code(500);
    echo json_encode(['error' => 'Ugyldig service account JSON']);
    exit;
}

$projectId = $sa['project_id'];

// Fuld token-verifikation nu hvor project_id kendes
if (!verify_firebase_id_token($bearerToken, $projectId)) {
    http_response_code(401);
    echo json_encode(['error' => 'Uautoriseret']);
    exit;
}

// ── OAuth access token via service account ────────────────────────────────────
$accessToken = getAccessToken($sa);
if (!$accessToken) {
    http_response_code(500);
    echo json_encode(['error' => 'Kunne ikke hente OAuth token']);
    exit;
}

// ── Hent alle brugere fra Firestore og filtrer på holdId ─────────────────────
$tokens = getFcmTokens($projectId, $accessToken, $holdIds);

if (empty($tokens)) {
    echo json_encode(['sent' => 0, 'message' => 'Ingen registrerede enheder for disse hold']);
    exit;
}

// ── Send FCM v1 push til hvert token ────────────────────────────────────────
$sent = 0; $failed = 0; $invalids = [];
foreach ($tokens as $token) {
    $result = sendFcmMessage($projectId, $accessToken, $token, $title, $text);
    if ($result === true) {
        $sent++;
    } elseif ($result === 'invalid') {
        $invalids[] = $token;
        $failed++;
    } else {
        $failed++;
    }
}

echo json_encode([
    'sent'    => $sent,
    'failed'  => $failed,
    'total'   => count($tokens),
]);

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

function base64url(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/** Henter et kortlivet OAuth 2.0 access token fra service account */
function getAccessToken(array $sa): string {
    $now     = time();
    $header  = base64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $payload = base64url(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => implode(' ', [
            'https://www.googleapis.com/auth/cloud-platform',
            'https://www.googleapis.com/auth/firebase.messaging',
        ]),
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ]));
    $unsigned = "$header.$payload";
    if (!openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256)) return '';
    $jwt = "$unsigned." . base64url($sig);

    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => 'Content-Type: application/x-www-form-urlencoded',
        'content' => http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
        'timeout' => 10,
    ]]);
    $res = @file_get_contents('https://oauth2.googleapis.com/token', false, $ctx);
    return $res ? (json_decode($res, true)['access_token'] ?? '') : '';
}

/**
 * Henter Firestore-dokumentet for alle brugere og returnerer
 * FCM-tokens for dem der tilhører mindst ét af de angivne hold.
 * Matcher på: users.holds (array) og users.familyMembers[].holdId
 */
function getFcmTokens(string $projectId, string $accessToken, array $holdIds): array {
    $holdSet = array_map('strval', $holdIds);  // normaliser til strings til sammenligning

    $ctx = stream_context_create(['http' => [
        'method'  => 'GET',
        'header'  => "Authorization: Bearer $accessToken",
        'timeout' => 10,
    ]]);

    $tokens  = [];
    $pageToken = null;

    do {
        $url = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/users?pageSize=300";
        if ($pageToken) $url .= "&pageToken=" . urlencode($pageToken);

        $res = @file_get_contents($url, false, $ctx);
        if (!$res) break;
        $data = json_decode($res, true);

        foreach ($data['documents'] ?? [] as $doc) {
            $fields = $doc['fields'] ?? [];
            $fcmToken = $fields['fcmToken']['stringValue'] ?? '';
            if (!$fcmToken) continue;

            if (empty($holdIds)) {
                // Ingen hold-filter: send til alle
                $tokens[] = $fcmToken;
                continue;
            }

            // Tjek users.holds array
            foreach ($fields['holds']['arrayValue']['values'] ?? [] as $v) {
                $id = (string)($v['stringValue'] ?? $v['integerValue'] ?? '');
                if ($id !== '' && in_array($id, $holdSet, true)) {
                    $tokens[] = $fcmToken;
                    continue 2;
                }
            }

            // Tjek familyMembers[].holdId
            foreach ($fields['familyMembers']['arrayValue']['values'] ?? [] as $member) {
                $mFields  = $member['mapValue']['fields'] ?? [];
                $memberHoldId = (string)($mFields['holdId']['stringValue']
                                       ?? $mFields['holdId']['integerValue']
                                       ?? '');
                if ($memberHoldId !== '' && in_array($memberHoldId, $holdSet, true)) {
                    $tokens[] = $fcmToken;
                    continue 2;
                }
            }
        }

        $pageToken = $data['nextPageToken'] ?? null;
    } while ($pageToken);

    return array_unique($tokens);
}

/** Sender en FCM-notifikation til ét token. Returnerer true, 'invalid' eller false. */
function sendFcmMessage(string $projectId, string $accessToken, string $token, string $title, string $body) {
    $payload = json_encode([
        'message' => [
            'token' => $token,
            'notification' => [
                'title' => $title,
                'body'  => $body,
            ],
            'android' => ['priority' => 'high'],
            'apns'    => ['payload' => ['aps' => ['sound' => 'default', 'badge' => 1]]],
            'webpush' => [
                'notification' => [
                    'icon'  => '/icon-192.png',
                    'badge' => '/icon-192.png',
                ],
                'fcm_options' => ['link' => '/'],
            ],
        ],
    ]);

    $ctx = stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => implode("\r\n", [
            'Content-Type: application/json',
            "Authorization: Bearer $accessToken",
        ]),
        'content'       => $payload,
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]);

    $res     = @file_get_contents(
        "https://fcm.googleapis.com/v1/projects/$projectId/messages:send",
        false, $ctx
    );
    $decoded = $res ? json_decode($res, true) : null;

    if (!$decoded) return false;
    if (isset($decoded['name'])) return true;  // succes: "projects/…/messages/…"

    $status = $decoded['error']['status'] ?? '';
    if (in_array($status, ['UNREGISTERED', 'INVALID_ARGUMENT'], true)) return 'invalid';
    return false;
}
