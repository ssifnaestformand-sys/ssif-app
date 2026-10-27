<?php
/**
 * Spillere på ét hold
 *
 * POST  Authorization: Bearer <token>
 *       { holdId: "123" }
 *
 * Returnerer: [{ id, navn }]  — sorteret alfabetisk, ingen kontaktdata
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

$lederHoldIds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHoldIds[$holdId])) {
    http_response_code(403); echo json_encode(['error' => 'Ingen adgang til dette hold']); exit;
}

// Hent members der har holdId i holdIds-feltet.
// Prøver stringValue og (hvis holdId er numerisk) integerValue — dækker alle sync-varianter.
$memberIds = [];
$spillere  = [];

function query_members_by_hold(string $projectId, string $fsToken, array $valueFilter): array {
    return fs_run_query($projectId, $fsToken, ['structuredQuery' => [
        'from'  => [['collectionId' => 'members']],
        'where' => ['fieldFilter' => [
            'field' => ['fieldPath' => 'holdIds'],
            'op'    => 'ARRAY_CONTAINS',
            'value' => $valueFilter,
        ]],
    ]]);
}

foreach (query_members_by_hold($projectId, $fsToken, ['stringValue' => $holdId]) as $row) {
    if (!isset($row['document']['fields'])) continue;
    $id = basename($row['document']['name'] ?? '');
    if ($id && !isset($memberIds[$id])) {
        $memberIds[$id] = true;
        $spillere[] = ['id' => $id, 'navn' => $row['document']['fields']['name']['stringValue'] ?? ''];
    }
}
if (ctype_digit($holdId)) {
    foreach (query_members_by_hold($projectId, $fsToken, ['integerValue' => (int)$holdId]) as $row) {
        if (!isset($row['document']['fields'])) continue;
        $id = basename($row['document']['name'] ?? '');
        if ($id && !isset($memberIds[$id])) {
            $memberIds[$id] = true;
            $spillere[] = ['id' => $id, 'navn' => $row['document']['fields']['name']['stringValue'] ?? ''];
        }
    }
}

usort($spillere, fn($a, $b) => strcoll($a['navn'], $b['navn']));

echo json_encode($spillere);
