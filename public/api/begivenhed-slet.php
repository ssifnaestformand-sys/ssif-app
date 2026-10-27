<?php
/**
 * Slet en begivenhed og alle dens deltagere
 *
 * POST  Authorization: Bearer <token>
 *       { begivenhedId: "abc" }
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

$body         = json_decode(file_get_contents('php://input'), true) ?? [];
$begivenhedId = trim((string)($body['begivenhedId'] ?? ''));
if (!$begivenhedId) { http_response_code(400); echo json_encode(['error' => 'begivenhedId mangler']); exit; }

$doc = fs_get("{$base}/begivenheder/{$begivenhedId}", $fsToken);
if (!$doc) { http_response_code(404); echo json_encode(['error' => 'Ikke fundet']); exit; }

$holdId = $doc['fields']['holdId']['stringValue'] ?? '';
$lederHoldIds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHoldIds[$holdId])) {
    http_response_code(403); echo json_encode(['error' => 'Ingen adgang']); exit;
}

// Slet alle deltagere + begivenheden i ét batch.
// VIGTIGT: document-navne i commit skal bruge resource-format (projects/…),
// ikke HTTP request-URL (https://…).
$deltagerDocs = fs_list("{$base}/begivenheder/{$begivenhedId}/deltagere", $fsToken);
$writes = [];
foreach ($deltagerDocs as $d) {
    $writes[] = ['delete' => $d['name']];
    $token = $d['fields']['svarToken']['stringValue'] ?? '';
    if ($token) {
        $writes[] = ['delete' => "{$resourceBase}/svarlinks/{$token}"];
    }
}
$writes[] = ['delete' => "{$resourceBase}/begivenheder/{$begivenhedId}"];

$ok = fs_commit($projectId, $fsToken, $writes);
if (!$ok) {
    http_response_code(500);
    echo json_encode(['error' => 'Sletning fejlede — prøv igen']);
    exit;
}

echo json_encode(['ok' => true]);
