<?php
/**
 * Hent liste over udlæg.
 *
 * POST { } — kræver Bearer-token.
 *
 * Returnerer:
 *   {
 *     mine:       [{id, afdeling, belob, beskrivelse, status, indsendt, kvitteringUrl}],
 *     tilGodkendelse: [{...}]  // kun udlæg i afdelinger hvor brugeren er formand
 *   }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
require_once __DIR__ . '/_auth.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$auth       = trainer_auth();
$uid        = $auth['uid'];
$email      = $auth['email'];
$fsToken    = $auth['fsToken'];
$projectId  = $auth['projectId'];
$base       = $auth['base'];

function fmt_udlaeg(array $doc): array {
    $f  = $doc['fields'] ?? [];
    $id = basename($doc['name'] ?? '');
    return [
        'id'            => $id,
        'afdeling'      => $f['afdeling']['stringValue']    ?? '',
        'belob'         => (float)($f['belob']['doubleValue'] ?? $f['belob']['integerValue'] ?? 0),
        'beskrivelse'   => $f['beskrivelse']['stringValue']  ?? '',
        'status'        => $f['status']['stringValue']       ?? '',
        'indsendt'      => $f['indsendt']['timestampValue']  ?? '',
        'kvitteringUrl' => $f['kvitteringUrl']['stringValue']?? '',
        'afsenderNavn'  => $f['afsenderNavn']['stringValue'] ?? '',
        'afsenderEmail' => $f['afsenderEmail']['stringValue']?? '',
        'kontering'     => $f['kontering']['stringValue']    ?? '',
        'konteringNavn' => $f['konteringNavn']['stringValue']?? '',
        'godkendtAf'    => $f['godkendtAf']['stringValue']   ?? '',
        'godkendtAt'    => $f['godkendtAt']['timestampValue']?? '',
        'afvistAf'      => $f['afvistAf']['stringValue']     ?? '',
        'afvisningsBeskrivelse' => $f['afvisningsBeskrivelse']['stringValue'] ?? '',
    ];
}

// ── Mine egne udlæg (ingen orderBy = ingen composite index nødvendig) ─────────
$mineRows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
    'from'  => [['collectionId' => 'udlaeg']],
    'where' => ['fieldFilter' => [
        'field' => ['fieldPath' => 'afsenderUid'],
        'op'    => 'EQUAL',
        'value' => ['stringValue' => $uid],
    ]],
    'limit' => 50,
]]);

$mine = [];
foreach ($mineRows as $r) {
    if (!isset($r['document'])) continue;
    $mine[] = fmt_udlaeg($r['document']);
}
usort($mine, fn($a, $b) => strcmp($b['indsendt'], $a['indsendt']));

// ── Til godkendelse (formand-view) ────────────────────────────────────────────
$tilGodkendelse = [];
if ($email) {
    $configDoc  = fs_get("{$base}/settings/udlaeg_config", $fsToken);
    $config     = $configDoc['fields'] ?? [];
    $afdelinger = json_decode($config['afdelinger']['stringValue'] ?? '{}', true) ?: [];
    $hbEmail    = $config['hb_formand_email']['stringValue'] ?? '';

    $formandFor = [];
    foreach ($afdelinger as $afdId => $afd) {
        if (($afd['formand_email'] ?? '') === $email) $formandFor[] = $afdId;
    }
    $erHB = ($hbEmail && $email === $hbEmail);

    // Formand: hent afventer_formand og filtrer til egne afdelinger i PHP
    if (!empty($formandFor)) {
        $rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
            'from'  => [['collectionId' => 'udlaeg']],
            'where' => ['fieldFilter' => ['field' => ['fieldPath' => 'status'], 'op' => 'EQUAL', 'value' => ['stringValue' => 'afventer_formand']]],
            'limit' => 200,
        ]]);
        foreach ($rows as $r) {
            if (!isset($r['document'])) continue;
            $u = fmt_udlaeg($r['document']);
            if (in_array($u['afdeling'], $formandFor)) $tilGodkendelse[] = $u;
        }
    }

    // HB-formand: hent afventer_hb
    if ($erHB) {
        $rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
            'from'  => [['collectionId' => 'udlaeg']],
            'where' => ['fieldFilter' => ['field' => ['fieldPath' => 'status'], 'op' => 'EQUAL', 'value' => ['stringValue' => 'afventer_hb']]],
            'limit' => 200,
        ]]);
        foreach ($rows as $r) {
            if (!isset($r['document'])) continue;
            $tilGodkendelse[] = fmt_udlaeg($r['document']);
        }
    }

    usort($tilGodkendelse, fn($a, $b) => strcmp($b['indsendt'], $a['indsendt']));
}

echo json_encode(['mine' => $mine, 'tilGodkendelse' => $tilGodkendelse], JSON_UNESCAPED_UNICODE);
