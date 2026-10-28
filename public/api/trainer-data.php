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

$tc = trainer_app_config($base, $fsToken);
echo json_encode(['name' => $displayName, 'holds' => $holds, 'testMode' => $tc['testMode']]);
