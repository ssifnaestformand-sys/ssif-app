<?php
/**
 * Hent kommunikationsforbrug for et hold.
 *
 * POST  Authorization: Bearer <token>
 *       { holdId: "123" }
 *
 * Returnerer: { total: {sms, mail, kroner}, udsendelser: [{...}] }
 */

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

set_time_limit(30);

$auth         = trainer_auth();
$email        = $auth['email'];
$conventus_id = $auth['conventus_id'];
$fsToken      = $auth['fsToken'];
$projectId    = $auth['projectId'];

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$holdId = trim((string)($body['holdId'] ?? ''));
if (!$holdId) { http_response_code(400); echo json_encode(['error' => 'holdId mangler']); exit; }

$lederHolds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHolds[$holdId])) { http_response_code(403); echo json_encode(['error' => 'Ingen adgang']); exit; }

// Query kommunikation_logs where holdId == holdId, sortér nyest først
$rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
    'from'  => [['collectionId' => 'kommunikation_logs']],
    'where' => ['fieldFilter' => [
        'field' => ['fieldPath' => 'holdId'],
        'op'    => 'EQUAL',
        'value' => ['stringValue' => $holdId],
    ]],
    'orderBy' => [['field' => ['fieldPath' => 'sentAt'], 'direction' => 'DESCENDING']],
    'limit' => 200,
]]);

$totalSms   = 0;
$totalMail  = 0;
$totalKr    = 0.0;
$udsendelser = [];

foreach ($rows as $row) {
    if (!isset($row['document']['fields'])) continue;
    $f = $row['document']['fields'];

    $channel = $f['channel']['stringValue'] ?? '';
    $sendt   = (int)($f['sendt']['integerValue'] ?? 0);
    $parts   = (int)($f['parts']['integerValue'] ?? 1);
    $cost    = (float)($f['estimatedCost']['doubleValue'] ?? $f['estimatedCost']['integerValue'] ?? 0);
    $sentAt  = $f['sentAt']['timestampValue'] ?? null;

    if ($channel === 'sms') { $totalSms += $sendt; $totalKr += $cost; }
    if ($channel === 'email') { $totalMail += $sendt; }

    // Hent hold-titel fra begivenhed-id hvis muligt
    $titel = $f['holdTitel']['stringValue'] ?? '';
    if (isset($f['begivenhedId']['stringValue'])) {
        $titel = $f['holdTitel']['stringValue'] . ' — ' . ($f['begivenhedId']['stringValue'] ? substr($f['begivenhedId']['stringValue'], 0, 6) . '…' : '');
    }

    $udsendelser[] = [
        'sentAt'  => $sentAt,
        'channel' => $channel,
        'titel'   => $titel ?: $holdId,
        'sendt'   => $sendt,
        'parts'   => $parts,
        'kroner'  => $cost > 0 ? $cost : null,
    ];
}

echo json_encode([
    'total'       => ['sms' => $totalSms, 'mail' => $totalMail, 'kroner' => round($totalKr, 2)],
    'udsendelser' => $udsendelser,
]);
