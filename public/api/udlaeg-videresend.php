<?php
/**
 * Videresend et afventende udlæg til en specifik godkender.
 *
 * POST {
 *   udlaegId:       string,
 *   godkenderEmail: string,  // email på den der skal godkende
 * }
 *
 * Kun admins. Sætter godkenderEmail-feltet på udlægget og sender notifikationsmail.
 * Feltet godkenderEmail har forrang frem for afdelingens konfigurerede formand_email
 * i udlaeg-godkend.php og udlaeg-liste.php.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_send_helpers.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$auth        = trainer_auth();
$uid         = $auth['uid'];
$fsToken     = $auth['fsToken'];
$projectId   = $auth['projectId'];
$base        = $auth['base'];

// Kræver admin
$userDoc = fs_get("{$base}/users/{$uid}", $fsToken);
$isAdmin = ($userDoc['fields']['isAdmin']['booleanValue'] ?? false)
        || in_array($userDoc['fields']['role']['stringValue'] ?? '', ['admin'], true);
if (!$isAdmin) {
    http_response_code(403);
    echo json_encode(['error' => 'Kun admins kan videresende udlæg']);
    exit;
}

$raw            = json_decode(file_get_contents('php://input'), true) ?: [];
$udlaegId       = trim($raw['udlaegId']        ?? '');
$godkenderEmail = strtolower(trim($raw['godkenderEmail'] ?? ''));

if (!$udlaegId)       { http_response_code(400); echo json_encode(['error' => 'udlaegId mangler']); exit; }
if (!$godkenderEmail) { http_response_code(400); echo json_encode(['error' => 'godkenderEmail mangler']); exit; }

// Hent udlæg
$udlaegDoc = fs_get("{$base}/udlaeg/{$udlaegId}", $fsToken);
if (!$udlaegDoc) { http_response_code(404); echo json_encode(['error' => 'Udlæg ikke fundet']); exit; }
$uf     = $udlaegDoc['fields'];
$status = $uf['status']['stringValue'] ?? '';

if (!in_array($status, ['afventer_formand', 'afventer_hb'], true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Kun afventende udlæg kan videresentdes']);
    exit;
}

// Sæt godkenderEmail på udlægget
$updateMask = 'updateMask.fieldPaths=godkenderEmail';
@file_get_contents("{$base}/udlaeg/{$udlaegId}?{$updateMask}", false, stream_context_create(['http' => [
    'method'        => 'PATCH',
    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode(['fields' => ['godkenderEmail' => ['stringValue' => $godkenderEmail]]]),
    'timeout'       => 10,
    'ignore_errors' => true,
]]));

// Send notifikationsmail til ny godkender
$mailData = [
    'afsenderNavn' => $uf['afsenderNavn']['stringValue'] ?? '',
    'afdeling'     => $uf['afdeling']['stringValue']     ?? '',
    'belob'        => (float)($uf['belob']['doubleValue'] ?? $uf['belob']['integerValue'] ?? 0),
    'beskrivelse'  => $uf['beskrivelse']['stringValue']  ?? '',
    'kvitteringUrl'=> $uf['kvitteringUrl']['stringValue']?? '',
];
smtp_send_html(
    $godkenderEmail,
    'Udlæg videresendt til din godkendelse — ' . $mailData['afdeling'],
    byg_udlaeg_notif_html($mailData)
);

echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
