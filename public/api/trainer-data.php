<?php
/**
 * Træner-adgang og holddata
 *
 * POST  Authorization: Bearer <Firebase ID-token>
 *
 * Returnerer:
 *   { name, holds: [{ id, titel, afdeling? }] }  — ved adgang
 *   { error: 'no_trainer_access' }                — ikke leder på noget aktivt hold
 *
 * Adgang afgøres KUN af lederHolds i members-collection.
 * Ingen skriv til Firestore.
 */

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit;
}

set_time_limit(30);

$auth         = trainer_auth();
$uid          = $auth['uid'];
$email        = $auth['email'];
$conventus_id = $auth['conventus_id'];
$fsToken      = $auth['fsToken'];
$projectId    = $auth['projectId'];
$base         = $auth['base'];

// ── Find alle matchende member-docs (til navn + lederHolds) ───────────────────
$memberDocs = [];

if ($conventus_id !== '') {
    $doc = fs_get("{$base}/members/{$conventus_id}", $fsToken);
    if ($doc) $memberDocs[$conventus_id] = $doc['fields'];
}
if ($email !== '') {
    $rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
        'from'  => [['collectionId' => 'members']],
        'where' => ['fieldFilter' => [
            'field' => ['fieldPath' => 'allEmails'],
            'op'    => 'ARRAY_CONTAINS',
            'value' => ['stringValue' => $email],
        ]],
    ]]);
    foreach ($rows as $row) {
        if (!isset($row['document']['fields'])) continue;
        $docId = basename($row['document']['name'] ?? '');
        if ($docId) $memberDocs[$docId] = $row['document']['fields'];
    }
}

if (empty($memberDocs)) {
    echo json_encode(['error' => 'no_trainer_access']); exit;
}

// ── Saml lederHolds og displayName fra alle docs ──────────────────────────────
$lederHoldIds = [];
$displayName  = '';
foreach ($memberDocs as $fields) {
    if ($displayName === '') {
        $displayName = $fields['name']['stringValue'] ?? '';
    }
    foreach ($fields['lederHolds']['arrayValue']['values'] ?? [] as $v) {
        $id = (string)($v['integerValue'] ?? $v['stringValue'] ?? '');
        if ($id !== '') $lederHoldIds[$id] = true;
    }
}

if (empty($lederHoldIds)) {
    echo json_encode(['error' => 'no_trainer_access']); exit;
}

// ── Hent holds ────────────────────────────────────────────────────────────────
$holds = [];
foreach (array_keys($lederHoldIds) as $holdId) {
    $doc = fs_get("{$base}/holds/{$holdId}", $fsToken);
    if (!$doc) continue;
    $f = $doc['fields'];
    if (isset($f['aktiv']['booleanValue']) && $f['aktiv']['booleanValue'] === false) continue;
    $holds[] = [
        'id'       => $holdId,
        'titel'    => $f['titel']['stringValue'] ?? "Hold {$holdId}",
        'afdeling' => $f['afdeling']['stringValue'] ?? null,
    ];
}

usort($holds, fn($a, $b) => strcoll($a['titel'], $b['titel']));

// ── Opdatér users/{uid} – registrerer login og gemmer hold-tilknytning ─────────
// Bruges af backoffice til at se hvilke trænere der har logget ind og hvilke hold de leder.
// role='admin' overskrives aldrig — kun trainer-specifikke felter opdateres for admin-konti.
$now     = date('Y-m-d\TH:i:s\Z');
$uFields = [
    'displayName'  => ['stringValue' => $displayName],
    'email'        => ['stringValue' => $email],
    'conventus_id' => ['stringValue' => $conventus_id],
    'lastSeen'     => ['timestampValue' => $now],
    'lederHolds'   => ['arrayValue' => ['values' => array_values(array_map(
        fn($id) => ['stringValue' => $id],
        array_keys($lederHoldIds)
    ))]],
];
// Tilføj kun role='trainer' hvis eksisterende doc ikke allerede har role='admin'
$existingDoc  = fs_get("{$base}/users/{$uid}", $fsToken);
$existingRole = $existingDoc['fields']['role']['stringValue'] ?? '';
if ($existingRole !== 'admin') {
    $uFields['role'] = ['stringValue' => 'trainer'];
}
$mask = implode('&', array_map(fn($k) => 'updateMask.fieldPaths=' . urlencode($k), array_keys($uFields)));
@file_get_contents("{$base}/users/{$uid}?{$mask}", false, stream_context_create(['http' => [
    'method'        => 'PATCH',
    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode(['fields' => $uFields]),
    'timeout'       => 5,
    'ignore_errors' => true,
]]));

$tc = trainer_app_config($base, $fsToken);
echo json_encode(['name' => $displayName, 'holds' => $holds, 'testMode' => $tc['testMode']]);
