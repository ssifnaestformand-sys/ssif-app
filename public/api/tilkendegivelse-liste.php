<?php
/**
 * Liste over tilkendegivelser for et hold.
 *
 * POST  Authorization: Bearer <token>
 *       { holdId: "12345" }
 *
 * Returnerer: [{ id, titel, datoer, status, oprettetAt }]
 * Datoerne er sorteret nyeste øverst.
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

$lederHolds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHolds[$holdId])) { http_response_code(403); echo json_encode(['error' => 'Ingen adgang']); exit; }

$rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
    'from'    => [['collectionId' => 'tilkendegivelser']],
    'where'   => ['fieldFilter' => [
        'field' => ['fieldPath' => 'holdId'],
        'op'    => 'EQUAL',
        'value' => ['stringValue' => $holdId],
    ]],
    'orderBy' => [['field' => ['fieldPath' => 'oprettetAt'], 'direction' => 'DESCENDING']],
    'limit'   => 50,
]]);

$liste = [];
foreach ($rows as $row) {
    if (!isset($row['document']['fields'])) continue;
    $docId = basename($row['document']['name'] ?? '');
    if (!$docId) continue;
    $f = $row['document']['fields'];

    $datoer = [];
    foreach ($f['datoer']['arrayValue']['values'] ?? [] as $d) {
        $df = $d['mapValue']['fields'] ?? [];
        $datoer[] = [
            'dato'      => $df['dato']['stringValue']      ?? '',
            'tidspunkt' => $df['tidspunkt']['stringValue'] ?? null,
            'modetid'   => $df['modetid']['stringValue']   ?? null,
            'sted'      => $df['sted']['stringValue']      ?? null,
        ];
    }

    $liste[] = [
        'id'         => $docId,
        'titel'      => $f['titel']['stringValue']             ?? '',
        'datoer'     => $datoer,
        'status'     => $f['status']['stringValue']            ?? 'kladde',
        'svarfrist'  => $f['svarfrist']['stringValue']         ?? null,
        'oprettetAt' => $f['oprettetAt']['timestampValue']     ?? null,
    ];
}

echo json_encode($liste);
