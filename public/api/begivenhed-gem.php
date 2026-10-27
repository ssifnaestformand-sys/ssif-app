<?php
/**
 * Opret eller ret en begivenhed med deltagere
 *
 * POST  Authorization: Bearer <token>
 *       {
 *         begivenhedId: null | "abc",   // null = opret, string = ret
 *         holdId, type, titel, dato, tidspunkt,
 *         modetid?, sted?, beskrivelse?,
 *         deltagere: [{ id, navn, udtaget }]
 *       }
 *
 * Returnerer: { id: "abc123" }
 *
 * svarToken genereres ved oprettelse og bevares ved rettelse.
 * svar/svarTidspunkt bevares ved rettelse.
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

$begivenhedId = isset($body['begivenhedId']) ? (string)$body['begivenhedId'] : null;
if ($begivenhedId === 'null' || $begivenhedId === '') $begivenhedId = null;
$holdId      = trim((string)($body['holdId'] ?? ''));
$type        = trim((string)($body['type'] ?? ''));
$titel       = trim((string)($body['titel'] ?? ''));
$dato        = trim((string)($body['dato'] ?? ''));
$tidspunkt   = trim((string)($body['tidspunkt'] ?? ''));
$modetid     = trim((string)($body['modetid'] ?? ''));
$sted        = trim((string)($body['sted'] ?? ''));
$beskrivelse = trim((string)($body['beskrivelse'] ?? ''));
$deltagere   = $body['deltagere'] ?? [];

if (!$holdId || !$type || !$titel || !$dato || !$tidspunkt) {
    http_response_code(400); echo json_encode(['error' => 'Manglende påkrævede felter (holdId, type, titel, dato, tidspunkt)']); exit;
}
if (!in_array($type, ['kamp', 'stævne', 'event', 'møde'], true)) {
    http_response_code(400); echo json_encode(['error' => 'Ugyldigt type']); exit;
}

$lederHoldIds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHoldIds[$holdId])) {
    http_response_code(403); echo json_encode(['error' => 'Ingen adgang til dette hold']); exit;
}

$now = date('Y-m-d\TH:i:s\Z');

$bevFields = [
    'holdId'          => ['stringValue' => $holdId],
    'type'            => ['stringValue' => $type],
    'titel'           => ['stringValue' => $titel],
    'dato'            => ['stringValue' => $dato],
    'tidspunkt'       => ['stringValue' => $tidspunkt],
    'modetid'         => $modetid ? ['stringValue' => $modetid] : ['nullValue' => null],
    'sted'            => $sted    ? ['stringValue' => $sted]    : ['nullValue' => null],
    'beskrivelse'     => $beskrivelse ? ['stringValue' => $beskrivelse] : ['nullValue' => null],
    'status'          => ['stringValue' => 'kladde'],
    'opdateretAt'     => ['timestampValue' => $now],
    'svarfrist'       => ['nullValue' => null],
    'extraSpørgsmaal' => ['nullValue' => null],
];

if ($begivenhedId === null) {
    // ── Opret ────────────────────────────────────────────────────────────────
    $bevFields['oprettetAf'] = ['stringValue' => $uid];
    $bevFields['oprettetAt'] = ['timestampValue' => $now];

    $newId = fs_create($projectId, $fsToken, 'begivenheder', $bevFields);
    if (!$newId) { http_response_code(500); echo json_encode(['error' => 'Opret fejlede']); exit; }

    $writes = [];
    foreach ($deltagere as $d) {
        $memberId = trim((string)($d['id'] ?? ''));
        if (!$memberId) continue;
        $writes[] = ['update' => [
            'name'   => "{$resourceBase}/begivenheder/{$newId}/deltagere/{$memberId}",
            'fields' => [
                'navn'          => ['stringValue' => trim((string)($d['navn'] ?? ''))],
                'udtaget'       => ['booleanValue' => (bool)($d['udtaget'] ?? true)],
                'svar'          => ['nullValue' => null],
                'svarTidspunkt' => ['nullValue' => null],
                'svarToken'     => ['stringValue' => bin2hex(random_bytes(16))],
                'extraSvar'     => ['nullValue' => null],
            ],
        ]];
    }
    if (!empty($writes)) fs_commit($projectId, $fsToken, $writes);

    echo json_encode(['id' => $newId]);
} else {
    // ── Ret ──────────────────────────────────────────────────────────────────
    $doc = fs_get("{$base}/begivenheder/{$begivenhedId}", $fsToken);
    if (!$doc || ($doc['fields']['holdId']['stringValue'] ?? '') !== $holdId) {
        http_response_code(404); echo json_encode(['error' => 'Begivenhed ikke fundet']); exit;
    }

    // Opdatér begivenhed-doc (beholder oprettetAf/oprettetAt)
    $maskParts = array_map(fn($k) => 'updateMask.fieldPaths=' . urlencode($k), array_keys($bevFields));
    $patchUrl  = "{$base}/begivenheder/{$begivenhedId}?" . implode('&', $maskParts);
    @file_get_contents($patchUrl, false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => $bevFields]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));

    // Hent eksisterende deltagere — bevar svar og svarToken
    $existingDocs = fs_list("{$base}/begivenheder/{$begivenhedId}/deltagere", $fsToken);
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
        $ex = $existing[$memberId] ?? null;
        $writes[] = ['update' => [
            'name'   => "{$resourceBase}/begivenheder/{$begivenhedId}/deltagere/{$memberId}",
            'fields' => [
                'navn'          => ['stringValue' => trim((string)($d['navn'] ?? ''))],
                'udtaget'       => ['booleanValue' => (bool)($d['udtaget'] ?? true)],
                'svar'          => $ex['svar']          ?? ['nullValue' => null],
                'svarTidspunkt' => $ex['svarTidspunkt'] ?? ['nullValue' => null],
                'svarToken'     => $ex['svarToken']     ?? ['stringValue' => bin2hex(random_bytes(16))],
                'extraSvar'     => $ex['extraSvar']     ?? ['nullValue' => null],
            ],
        ]];
    }
    foreach (array_keys($existing) as $memberId) {
        if (!isset($newMemberIds[$memberId])) {
            $writes[] = ['delete' => "{$resourceBase}/begivenheder/{$begivenhedId}/deltagere/{$memberId}"];
        }
    }
    if (!empty($writes)) fs_commit($projectId, $fsToken, $writes);

    echo json_encode(['id' => $begivenhedId]);
}
