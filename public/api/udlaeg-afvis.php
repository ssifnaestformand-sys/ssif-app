<?php
/**
 * Afvis et udlæg med begrundelse.
 *
 * POST {
 *   udlaegId:     string,
 *   begrundelse:  string,
 * }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_send_helpers.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$auth       = trainer_auth();
$uid        = $auth['uid'];
$email      = $auth['email'];
$displayName = $auth['displayName'] ?: $email;
$fsToken    = $auth['fsToken'];
$projectId  = $auth['projectId'];
$base       = $auth['base'];

$raw          = json_decode(file_get_contents('php://input'), true) ?: [];
$udlaegId     = trim($raw['udlaegId']    ?? '');
$begrundelse  = trim($raw['begrundelse'] ?? '');

if (!$udlaegId)    { http_response_code(400); echo json_encode(['error' => 'udlaegId mangler']); exit; }
if (!$begrundelse) { http_response_code(400); echo json_encode(['error' => 'Begrundelse mangler']); exit; }

// ── Hent udlæg og config ──────────────────────────────────────────────────────
$udlaegDoc = fs_get("{$base}/udlaeg/{$udlaegId}", $fsToken);
if (!$udlaegDoc) { http_response_code(404); echo json_encode(['error' => 'Udlæg ikke fundet']); exit; }
$uf = $udlaegDoc['fields'];

$configDoc  = fs_get("{$base}/settings/udlaeg_config", $fsToken);
$config     = $configDoc['fields'] ?? [];
$afdelinger = json_decode($config['afdelinger']['stringValue'] ?? '{}', true) ?: [];
$hbEmail    = $config['hb_formand_email']['stringValue'] ?? '';

$afdeling     = $uf['afdeling']['stringValue'] ?? '';
$status       = $uf['status']['stringValue']   ?? '';
$formandEmail = $afdelinger[$afdeling]['formand_email'] ?? '';

// ── Autorisationstjek ─────────────────────────────────────────────────────────
$erFormand = $email && $email === $formandEmail;
$erHB      = $email && $email === $hbEmail;

$maaAfvise = ($status === 'afventer_formand' && $erFormand)
          || ($status === 'afventer_hb'      && $erHB);

if (!$maaAfvise) {
    http_response_code(403);
    echo json_encode(['error' => 'Du har ikke ret til at afvise dette udlæg']);
    exit;
}

// ── Opdatér udlæg i Firestore ─────────────────────────────────────────────────
$now = date('Y-m-d\TH:i:s\Z');
$updateFields = [
    'status'                => ['stringValue'    => 'afvist'],
    'afvistAf'              => ['stringValue'    => $displayName],
    'afvistAt'              => ['timestampValue' => $now],
    'afvisningsBeskrivelse' => ['stringValue'    => $begrundelse],
];
$updateMask = implode('&', array_map(fn($k) => 'updateMask.fieldPaths=' . urlencode($k), array_keys($updateFields)));
@file_get_contents("{$base}/udlaeg/{$udlaegId}?{$updateMask}", false, stream_context_create(['http' => [
    'method'        => 'PATCH',
    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode(['fields' => $updateFields]),
    'timeout'       => 10,
    'ignore_errors' => true,
]]));

// ── Slet bankoplysninger ──────────────────────────────────────────────────────
@file_get_contents("https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/udlaeg_bank/{$udlaegId}", false,
    stream_context_create(['http' => [
        'method'        => 'DELETE',
        'header'        => "Authorization: Bearer {$fsToken}\r\n",
        'timeout'       => 5,
        'ignore_errors' => true,
    ]]));

// ── Send afvisningsmail til afsender ─────────────────────────────────────────
$afsenderEmail = $uf['afsenderEmail']['stringValue'] ?? '';
if ($afsenderEmail) {
    $aData = [
        'afdeling'               => $afdeling,
        'belob'                  => (float)($uf['belob']['doubleValue'] ?? 0),
        'beskrivelse'            => $uf['beskrivelse']['stringValue']   ?? '',
        'afvisningsBeskrivelse'  => $begrundelse,
    ];
    smtp_send_html($afsenderEmail, 'Dit udlæg er blevet afvist', byg_udlaeg_afvist_html($aData));
}

echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
