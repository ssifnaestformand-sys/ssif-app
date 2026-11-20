<?php
/**
 * Indsend nyt udlæg.
 *
 * POST {
 *   afdeling:      string,  // afdeling-ID/navn
 *   belob:         float,   // beløb i kr. (decimaler tilladt)
 *   beskrivelse:   string,
 *   kvitteringUrl: string,  // URL fra upload-image.php
 *   regNr:         string,  // REG-NR — gemmes ALDRIG i udlaeg-collection
 *   kontoNr:       string,  // KONTO-NR — gemmes ALDRIG i udlaeg-collection
 * }
 *
 * Bankoplysninger gemmes i en separat PHP-only collection (udlaeg_bank) og
 * slettes automatisk, når bogholder-mailen er sendt efter godkendelse.
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
$conventus  = $auth['conventus_id'];
$displayName = $auth['displayName'] ?: ($email ?: $uid);
$fsToken    = $auth['fsToken'];
$projectId  = $auth['projectId'];
$base       = $auth['base'];

$raw         = json_decode(file_get_contents('php://input'), true) ?: [];
$afdeling    = trim($raw['afdeling']      ?? '');
$belob       = (float)($raw['belob']      ?? 0);
$beskrivelse = trim($raw['beskrivelse']   ?? '');
$kvitUrl     = trim($raw['kvitteringUrl'] ?? '');
$regNr       = trim($raw['regNr']         ?? '');
$kontoNr     = trim($raw['kontoNr']       ?? '');

if (!$afdeling)    { http_response_code(400); echo json_encode(['error' => 'Afdeling mangler']); exit; }
if ($belob <= 0)   { http_response_code(400); echo json_encode(['error' => 'Beløb skal være større end 0']); exit; }
if (!$beskrivelse) { http_response_code(400); echo json_encode(['error' => 'Beskrivelse mangler']); exit; }
if (!$kvitUrl)     { http_response_code(400); echo json_encode(['error' => 'Kvittering mangler']); exit; }
if (!$regNr || !$kontoNr) { http_response_code(400); echo json_encode(['error' => 'Bankoplysninger mangler (REG-NR og KONTO-NR)']); exit; }

// ── Valider at brugeren er leder for den valgte afdeling ──────────────────────
$lederHoldIds = get_leder_holds($email, $conventus, $projectId, $fsToken);
$harAdgang = false;
foreach (array_keys($lederHoldIds) as $holdId) {
    $holdDoc = fs_get("{$base}/holds/{$holdId}", $fsToken);
    if (!$holdDoc) continue;
    $afdId = (string)(
        $holdDoc['fields']['afdeling_id']['integerValue'] ??
        $holdDoc['fields']['afdeling_id']['stringValue']  ?? ''
    );
    if (!$afdId) continue;
    $afdDoc  = fs_get("{$base}/afdelinger/{$afdId}", $fsToken);
    $afdNavn = $afdDoc['fields']['navn']['stringValue'] ?? '';
    if ($afdNavn === $afdeling) { $harAdgang = true; break; }
}
if (!$harAdgang) {
    http_response_code(403);
    echo json_encode(['error' => 'Du er ikke leder for den valgte afdeling']);
    exit;
}

// ── Gem udlæg i Firestore (uden bankoplysninger) ─────────────────────────────
$now = date('Y-m-d\TH:i:s\Z');
$fields = [
    'afsenderUid'           => ['stringValue'    => $uid],
    'afsenderNavn'          => ['stringValue'    => $displayName],
    'afsenderEmail'         => ['stringValue'    => $email],
    'conventus_id'          => ['stringValue'    => $conventus],
    'afdeling'              => ['stringValue'    => $afdeling],
    'belob'                 => ['doubleValue'    => $belob],
    'beskrivelse'           => ['stringValue'    => $beskrivelse],
    'kvitteringUrl'         => ['stringValue'    => $kvitUrl],
    'status'                => ['stringValue'    => 'afventer_formand'],
    'indsendt'              => ['timestampValue' => $now],
    'godkendtAf'            => ['nullValue'      => null],
    'godkendtAt'            => ['nullValue'      => null],
    'afvistAf'              => ['nullValue'      => null],
    'afvistAt'              => ['nullValue'      => null],
    'afvisningsBeskrivelse' => ['stringValue'    => ''],
    'kontering'             => ['stringValue'    => ''],
    'konteringNavn'         => ['stringValue'    => ''],
];

$udlaegId = fs_create($projectId, $fsToken, 'udlaeg', $fields);
if (!$udlaegId) {
    http_response_code(500); echo json_encode(['error' => 'Kunne ikke gemme udlæg']); exit;
}

// ── Gem bankoplysninger i separat PHP-only collection (udlaeg_bank) ───────────
// Slettes af udlaeg-godkend.php når bogholder-mail er sendt.
$bankFields = [
    'udlaegId' => ['stringValue' => $udlaegId],
    'regNr'    => ['stringValue' => $regNr],
    'kontoNr'  => ['stringValue' => $kontoNr],
    'createdAt'=> ['timestampValue' => $now],
];
// PATCH med udlaegId som dokument-ID
$bankUrl = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/udlaeg_bank/{$udlaegId}";
@file_get_contents($bankUrl, false, stream_context_create(['http' => [
    'method'        => 'PATCH',
    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode(['fields' => $bankFields]),
    'timeout'       => 10,
    'ignore_errors' => true,
]]));

// ── Send notifikation til afdelingsformand ────────────────────────────────────
$configDoc    = fs_get("{$base}/settings/udlaeg_config", $fsToken);
$config       = $configDoc['fields'] ?? [];
$afdelinger   = json_decode($config['afdelinger']['stringValue'] ?? '{}', true) ?: [];
$formandEmail = $afdelinger[$afdeling]['formand_email'] ?? '';

if ($formandEmail) {
    $mailData = [
        'afsenderNavn' => $displayName,
        'afdeling'     => $afdeling,
        'belob'        => $belob,
        'beskrivelse'  => $beskrivelse,
        'kvitteringUrl'=> $kvitUrl,
    ];
    smtp_send_html($formandEmail, 'Nyt udlæg afventer godkendelse — ' . $afdeling, byg_udlaeg_notif_html($mailData));
}

echo json_encode(['ok' => true, 'id' => $udlaegId], JSON_UNESCAPED_UNICODE);
