<?php
/**
 * Detaljer + svar-pivot for én tilkendegivelse.
 *
 * POST  Authorization: Bearer <token>
 *       { tilkendegivelseId: "abc", holdId: "12345" }
 *
 * Returnerer:
 * {
 *   tilkendegivelse: { id, titel, datoer, besked, svarfrist, status, oprettetAt },
 *   deltagere: [{ id, navn, svar: { "YYYY-MM-DD": "kan"|"kan_ikke" }, harSvaret: bool }],
 *   pivot: [{ dato, kan: ["navn",...], kan_ikke: ["navn",...], ingen_svar: ["navn",...] }]
 * }
 *
 * svarToken sendes ALDRIG til klienten.
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

$body              = json_decode(file_get_contents('php://input'), true) ?? [];
$tilkendegivelseId = trim((string)($body['tilkendegivelseId'] ?? ''));
$holdId            = trim((string)($body['holdId']            ?? ''));

if (!$tilkendegivelseId || !$holdId) {
    http_response_code(400); echo json_encode(['error' => 'tilkendegivelseId og holdId er påkrævet']); exit;
}

$lederHolds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHolds[$holdId])) { http_response_code(403); echo json_encode(['error' => 'Ingen adgang']); exit; }

$doc = fs_get("{$base}/tilkendegivelser/{$tilkendegivelseId}", $fsToken);
if (!$doc || ($doc['fields']['holdId']['stringValue'] ?? '') !== $holdId) {
    http_response_code(404); echo json_encode(['error' => 'Tilkendegivelse ikke fundet']); exit;
}
$f = $doc['fields'];

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

$datoStrings = array_column($datoer, 'dato');

$tilkendegivelse = [
    'id'         => $tilkendegivelseId,
    'titel'      => $f['titel']['stringValue']         ?? '',
    'datoer'     => $datoer,
    'besked'     => $f['besked']['stringValue']        ?? null,
    'svarfrist'  => $f['svarfrist']['stringValue']     ?? null,
    'status'     => $f['status']['stringValue']        ?? 'kladde',
    'oprettetAt' => $f['oprettetAt']['timestampValue'] ?? null,
    'udsendt_at' => $f['udsendt_at']['timestampValue'] ?? null,
];

// Hent deltagere (uden svarToken)
$deltDocs = fs_list("{$base}/tilkendegivelser/{$tilkendegivelseId}/deltagere", $fsToken);

$deltagere = [];
$pivot     = []; // dato → [kan: [], kan_ikke: [], ingen_svar: []]
foreach ($datoStrings as $dato) {
    $pivot[$dato] = ['dato' => $dato, 'kan' => [], 'kan_ikke' => [], 'ingen_svar' => []];
}

foreach ($deltDocs as $d) {
    if (!isset($d['fields'])) continue;
    $memberId = basename($d['name'] ?? '');
    if (!$memberId) continue;
    $df  = $d['fields'];
    $navn = $df['navn']['stringValue'] ?? '';

    $svarMap = [];
    foreach ($df['svar']['mapValue']['fields'] ?? [] as $dato => $v) {
        $svarMap[$dato] = $v['stringValue'] ?? '';
    }

    $harSvaret = !empty($svarMap);

    $deltagere[] = [
        'id'        => $memberId,
        'navn'      => $navn,
        'svar'      => $svarMap,
        'harSvaret' => $harSvaret,
    ];

    foreach ($datoStrings as $dato) {
        $s = $svarMap[$dato] ?? '';
        if ($s === 'kan')      $pivot[$dato]['kan'][]       = $navn;
        elseif ($s === 'kan_ikke') $pivot[$dato]['kan_ikke'][] = $navn;
        else                   $pivot[$dato]['ingen_svar'][] = $navn;
    }
}

echo json_encode([
    'tilkendegivelse' => $tilkendegivelse,
    'deltagere'       => $deltagere,
    'pivot'           => array_values($pivot),
]);
