<?php
/**
 * Admin-trigget Conventus-synkronisering
 *
 * Kræver gyldig Firebase ID-token (fra indlogget backoffice-bruger).
 * Kalder internt sync-holds.php og/eller sync-members.php med SYNC_SECRET
 * så hemmeligheden aldrig eksponeres i browseren.
 *
 * POST-parametre:
 *   what = "holds" | "members" | "all"  (default: "all")
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

require_once __DIR__ . '/_auth.php';

// ── Firebase ID-token verifikation ────────────────────────────────────────────
$bearerToken = bearer_token();
if (!$bearerToken) {
    http_response_code(401);
    echo json_encode(['error' => 'Uautoriseret – log ind i backoffice']);
    exit;
}

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'Firebase service account mangler']);
    exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'] ?? '';
if (!$projectId || !verify_firebase_id_token($bearerToken, $projectId)) {
    http_response_code(401);
    echo json_encode(['error' => 'Uautoriseret']);
    exit;
}

// ── SYNC_SECRET hentes fra servermiljøet (aldrig eksponeret til browseren) ────
$syncSecret = getenv('SYNC_SECRET') ?: '';
if (!$syncSecret) {
    http_response_code(500);
    echo json_encode(['error' => 'SYNC_SECRET ikke konfigureret på serveren']);
    exit;
}

$what    = trim($_POST['what'] ?? 'all');
$base    = 'https://app.sejssvejbaek-if.dk/api';
$ctx     = stream_context_create(['http' => [
    'method'        => 'POST',
    'header'        => "X-Sync-Secret: {$syncSecret}\r\n",
    'timeout'       => 15,
    'ignore_errors' => true,
]]);

$results = [];

if ($what === 'holds' || $what === 'all') {
    $resp = @file_get_contents("{$base}/sync-holds.php", false, $ctx);
    $data = $resp ? json_decode($resp, true) : null;
    $results['holds'] = $data
        ? ['ok' => $data['ok'] ?? false, 'total' => $data['holds_total'] ?? 0, 'written' => $data['holds_written'] ?? 0]
        : ['ok' => false, 'error' => 'Ingen svar'];
}

if ($what === 'members' || $what === 'all') {
    // Medlemssynk kører i baggrunden (PHP fortsætter efter HTTP-timeout)
    @file_get_contents("{$base}/sync-members.php", false, $ctx);
    $results['members'] = ['ok' => true, 'note' => 'Startet i baggrunden (~30 sek.)'];
}

echo json_encode(['ok' => true, 'results' => $results, 'synced' => date('c')], JSON_UNESCAPED_UNICODE);
