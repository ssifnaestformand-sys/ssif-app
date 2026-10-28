<?php
/**
 * Opret eller ret en tilkendegivelse
 *
 * POST  Authorization: Bearer <token>
 *       {
 *         tilkendegivelseId: null | "abc",
 *         holdId, titel,
 *         datoer: [{ dato, tidspunkt?, modetid?, sted? }],
 *         besked?, svarfrist?,
 *         deltagere: [{ id, navn }]
 *       }
 *
 * Returnerer: { id: "abc123" }
 *
 * svarToken genereres pr. deltager ved oprettelse og bevares ved rettelse.
 * Svar bevares ved rettelse.
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
$uid          = $auth['uid'];
$email        = $auth['email'];
$conventus_id = $auth['conventus_id'];
$fsToken      = $auth['fsToken'];
$projectId    = $auth['projectId'];
$base         = $auth['base'];
$resourceBase = $auth['resourceBase'];

$body = json_decode(file_get_contents('php://input'), true) ?? [];

$tId       = isset($body['tilkendegivelseId']) ? (string)$body['tilkendegivelseId'] : null;
if ($tId === 'null' || $tId === '') $tId = null;
$holdId    = trim((string)($body['holdId']    ?? ''));
$titel     = trim((string)($body['titel']     ?? ''));
$datoer    = is_array($body['datoer'] ?? null) ? $body['datoer'] : [];
$besked    = trim((string)($body['besked']    ?? ''));
$svarfrist = trim((string)($body['svarfrist'] ?? ''));
$deltagere = is_array($body['deltagere'] ?? null) ? $body['deltagere'] : [];

if (!$holdId || !$titel || empty($datoer)) {
    http_response_code(400);
    echo json_encode(['error' => 'Manglende påkrævede felter (holdId, titel, datoer)']);
    exit;
}

$lederHoldIds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHoldIds[$holdId])) {
    http_response_code(403); echo json_encode(['error' => 'Ingen adgang til dette hold']); exit;
}

// Byg datoer-array til Firestore (arrayValue af mapValues)
$datoerValues = [];
foreach ($datoer as $d) {
    $dato = trim((string)($d['dato'] ?? ''));
    if (!$dato || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dato)) continue;
    $datoerValues[] = ['mapValue' => ['fields' => [
        'dato'      => ['stringValue' => $dato],
        'tidspunkt' => !empty($d['tidspunkt']) ? ['stringValue' => trim((string)$d['tidspunkt'])] : ['nullValue' => null],
        'modetid'   => !empty($d['modetid'])   ? ['stringValue' => trim((string)$d['modetid'])]   : ['nullValue' => null],
        'sted'      => !empty($d['sted'])       ? ['stringValue' => trim((string)$d['sted'])]       : ['nullValue' => null],
    ]]];
}
if (empty($datoerValues)) {
    http_response_code(400); echo json_encode(['error' => 'Ingen gyldige datoer']); exit;
}

$now = date('Y-m-d\TH:i:s\Z');

$tFields = [
    'holdId'    => ['stringValue' => $holdId],
    'titel'     => ['stringValue' => $titel],
    'datoer'    => ['arrayValue'  => ['values' => $datoerValues]],
    'besked'    => $besked ? ['stringValue' => $besked] : ['nullValue' => null],
    'svarfrist' => $svarfrist ? ['stringValue' => $svarfrist] : ['nullValue' => null],
    'status'    => ['stringValue' => 'kladde'],
    'opdateretAt' => ['timestampValue' => $now],
];

if ($tId === null) {
    // ── Opret ────────────────────────────────────────────────────────────────
    $tFields['oprettetAf'] = ['stringValue' => $uid];
    $tFields['oprettetAt'] = ['timestampValue' => $now];

    $newId = fs_create($projectId, $fsToken, 'tilkendegivelser', $tFields);
    if (!$newId) { http_response_code(500); echo json_encode(['error' => 'Opret fejlede']); exit; }

    $writes = [];
    foreach ($deltagere as $d) {
        $memberId = trim((string)($d['id'] ?? ''));
        if (!$memberId) continue;
        $token = bin2hex(random_bytes(16));
        $writes[] = ['update' => [
            'name'   => "{$resourceBase}/tilkendegivelser/{$newId}/deltagere/{$memberId}",
            'fields' => [
                'navn'      => ['stringValue' => trim((string)($d['navn'] ?? ''))],
                'svarToken' => ['stringValue' => $token],
                'svar'      => ['mapValue'    => ['fields' => (object)[]]],
                'opdateretAt' => ['nullValue'  => null],
            ],
        ]];
        $writes[] = ['update' => [
            'name'   => "{$resourceBase}/svarlinks/{$token}",
            'fields' => [
                'tilkendegivelseId' => ['stringValue' => $newId],
                'memberId'          => ['stringValue' => $memberId],
            ],
        ]];
    }
    if (!empty($writes)) {
        $ok = fs_commit($projectId, $fsToken, $writes);
        if (!$ok) {
            fs_commit($projectId, $fsToken, [['delete' => "{$resourceBase}/tilkendegivelser/{$newId}"]]);
            http_response_code(500);
            echo json_encode(['error' => 'Deltagere kunne ikke gemmes']);
            exit;
        }
    }

    echo json_encode(['id' => $newId]);
} else {
    // ── Ret ──────────────────────────────────────────────────────────────────
    $doc = fs_get("{$base}/tilkendegivelser/{$tId}", $fsToken);
    if (!$doc || ($doc['fields']['holdId']['stringValue'] ?? '') !== $holdId) {
        http_response_code(404); echo json_encode(['error' => 'Tilkendegivelse ikke fundet']); exit;
    }

    // Bevar status hvis allerede udsendt
    $nuværendeStatus = $doc['fields']['status']['stringValue'] ?? 'kladde';
    if ($nuværendeStatus !== 'kladde') {
        $tFields['status'] = ['stringValue' => $nuværendeStatus];
    }

    $maskParts = array_map(fn($k) => 'updateMask.fieldPaths=' . urlencode($k), array_keys($tFields));
    $patchUrl  = "{$base}/tilkendegivelser/{$tId}?" . implode('&', $maskParts);
    @file_get_contents($patchUrl, false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => $tFields]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));

    // Hent eksisterende deltagere — bevar svar og svarToken
    $existingDocs = fs_list("{$base}/tilkendegivelser/{$tId}/deltagere", $fsToken);
    $existing = [];
    foreach ($existingDocs as $d) {
        $memberId = basename($d['name'] ?? '');
        if ($memberId) $existing[$memberId] = $d['fields'];
    }

    $newMemberIds = [];
    $writes       = [];
    foreach ($deltagere as $d) {
        $memberId = trim((string)($d['id'] ?? ''));
        if (!$memberId) continue;
        $newMemberIds[$memberId] = true;
        $ex    = $existing[$memberId] ?? null;
        $token = $ex ? ($ex['svarToken']['stringValue'] ?? '') : '';
        if (!$token) $token = bin2hex(random_bytes(16));
        $writes[] = ['update' => [
            'name'   => "{$resourceBase}/tilkendegivelser/{$tId}/deltagere/{$memberId}",
            'fields' => [
                'navn'        => ['stringValue' => trim((string)($d['navn'] ?? ''))],
                'svarToken'   => ['stringValue' => $token],
                'svar'        => $ex['svar'] ?? ['mapValue' => ['fields' => (object)[]]],
                'opdateretAt' => $ex['opdateretAt'] ?? ['nullValue' => null],
            ],
        ]];
        if (!$ex) {
            $writes[] = ['update' => [
                'name'   => "{$resourceBase}/svarlinks/{$token}",
                'fields' => [
                    'tilkendegivelseId' => ['stringValue' => $tId],
                    'memberId'          => ['stringValue' => $memberId],
                ],
            ]];
        }
    }
    foreach (array_keys($existing) as $memberId) {
        if (!isset($newMemberIds[$memberId])) {
            $writes[] = ['delete' => "{$resourceBase}/tilkendegivelser/{$tId}/deltagere/{$memberId}"];
            $token = $existing[$memberId]['svarToken']['stringValue'] ?? '';
            if ($token) {
                $writes[] = ['delete' => "{$resourceBase}/svarlinks/{$token}"];
            }
        }
    }
    if (!empty($writes)) {
        $ok = fs_commit($projectId, $fsToken, $writes);
        if (!$ok) {
            http_response_code(500);
            echo json_encode(['error' => 'Deltagere kunne ikke gemmes — prøv igen']);
            exit;
        }
    }

    echo json_encode(['id' => $tId]);
}
