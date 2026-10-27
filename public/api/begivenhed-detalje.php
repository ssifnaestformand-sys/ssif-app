<?php
/**
 * Begivenhed med deltagere — UDEN svarToken
 *
 * POST  Authorization: Bearer <token>
 *       { begivenhedId: "abc" }
 *
 * Returnerer:
 *   { begivenhed: {...}, deltagere: [{ id, navn, udtaget, svar }] }
 *
 * svarToken sendes aldrig til klienten.
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

$body         = json_decode(file_get_contents('php://input'), true) ?? [];
$begivenhedId = trim((string)($body['begivenhedId'] ?? ''));
if (!$begivenhedId) { http_response_code(400); echo json_encode(['error' => 'begivenhedId mangler']); exit; }

$doc = fs_get("{$base}/begivenheder/{$begivenhedId}", $fsToken);
if (!$doc) { http_response_code(404); echo json_encode(['error' => 'Ikke fundet']); exit; }

$f      = $doc['fields'];
$holdId = $f['holdId']['stringValue'] ?? '';

$lederHoldIds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHoldIds[$holdId])) {
    http_response_code(403); echo json_encode(['error' => 'Ingen adgang']); exit;
}

$begivenhed = [
    'id'          => $begivenhedId,
    'holdId'      => $holdId,
    'type'        => $f['type']['stringValue']        ?? '',
    'titel'       => $f['titel']['stringValue']       ?? '',
    'dato'        => $f['dato']['stringValue']        ?? '',
    'tidspunkt'   => $f['tidspunkt']['stringValue']   ?? '',
    'modetid'     => $f['modetid']['stringValue']     ?? null,
    'sted'        => $f['sted']['stringValue']        ?? null,
    'beskrivelse' => $f['beskrivelse']['stringValue'] ?? null,
    'status'      => $f['status']['stringValue']      ?? 'kladde',
    'oprettetAf'  => $f['oprettetAf']['stringValue']  ?? '',
];

$deltagerDocs = fs_list("{$base}/begivenheder/{$begivenhedId}/deltagere", $fsToken);
$deltagere    = [];
foreach ($deltagerDocs as $d) {
    $df = $d['fields'];
    $deltagere[] = [
        'id'      => basename($d['name'] ?? ''),
        'navn'    => $df['navn']['stringValue']    ?? '',
        'udtaget' => $df['udtaget']['booleanValue'] ?? true,
        'svar'    => $df['svar']['stringValue']    ?? null,
    ];
}
usort($deltagere, fn($a, $b) => strcoll($a['navn'], $b['navn']));

echo json_encode(['begivenhed' => $begivenhed, 'deltagere' => $deltagere]);
