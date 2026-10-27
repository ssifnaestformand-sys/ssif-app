<?php
/**
 * Holddata + begivenheder for ét hold
 *
 * POST  Authorization: Bearer <token>
 *       { holdId: "123" }
 *
 * Returnerer:
 *   { hold: { id, titel, afdeling }, begivenheder: [{ id, type, titel, dato, tidspunkt, status }] }
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
$base         = $auth['base'];

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$holdId = trim((string)($body['holdId'] ?? ''));
if (!$holdId) { http_response_code(400); echo json_encode(['error' => 'holdId mangler']); exit; }

$lederHoldIds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHoldIds[$holdId])) {
    http_response_code(403); echo json_encode(['error' => 'Ingen adgang til dette hold']); exit;
}

// Hold-info
$doc = fs_get("{$base}/holds/{$holdId}", $fsToken);
$hold = [
    'id'       => $holdId,
    'titel'    => $doc['fields']['titel']['stringValue'] ?? "Hold {$holdId}",
    'afdeling' => $doc['fields']['afdeling']['stringValue'] ?? null,
];

// Begivenheder — query kun på holdId, sortér efter dato i PHP (ingen composite index)
$rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
    'from'  => [['collectionId' => 'begivenheder']],
    'where' => ['fieldFilter' => [
        'field' => ['fieldPath' => 'holdId'],
        'op'    => 'EQUAL',
        'value' => ['stringValue' => $holdId],
    ]],
]]);

$begivenheder = [];
foreach ($rows as $row) {
    if (!isset($row['document']['fields'])) continue;
    $f  = $row['document']['fields'];
    $id = basename($row['document']['name'] ?? '');
    if (!$id) continue;
    $begivenheder[] = [
        'id'        => $id,
        'type'      => $f['type']['stringValue'] ?? '',
        'titel'     => $f['titel']['stringValue'] ?? '',
        'dato'      => $f['dato']['stringValue'] ?? '',
        'tidspunkt' => $f['tidspunkt']['stringValue'] ?? '',
        'status'    => $f['status']['stringValue'] ?? 'kladde',
    ];
}

usort($begivenheder, fn($a, $b) => strcmp($a['dato'], $b['dato']));

echo json_encode(['hold' => $hold, 'begivenheder' => $begivenheder]);
