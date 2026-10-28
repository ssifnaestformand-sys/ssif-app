<?php
/**
 * Slet en tilkendegivelse inkl. alle deltagere og svarlinks.
 *
 * POST  Authorization: Bearer <token>
 *       { tilkendegivelseId: "abc", holdId: "12345" }
 *
 * Returnerer: { ok: true }
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
$resourceBase = $auth['resourceBase'];

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

$deltDocs = fs_list("{$base}/tilkendegivelser/{$tilkendegivelseId}/deltagere", $fsToken);

$writes = [];
foreach ($deltDocs as $d) {
    $memberId = basename($d['name'] ?? '');
    if (!$memberId) continue;
    $token = $d['fields']['svarToken']['stringValue'] ?? '';
    $writes[] = ['delete' => "{$resourceBase}/tilkendegivelser/{$tilkendegivelseId}/deltagere/{$memberId}"];
    if ($token) {
        $writes[] = ['delete' => "{$resourceBase}/svarlinks/{$token}"];
    }
}
$writes[] = ['delete' => "{$resourceBase}/tilkendegivelser/{$tilkendegivelseId}"];

if (!empty($writes)) {
    $ok = fs_commit($projectId, $fsToken, $writes);
    if (!$ok) {
        http_response_code(500); echo json_encode(['error' => 'Sletning fejlede — prøv igen']); exit;
    }
}

echo json_encode(['ok' => true]);
