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

// ── Mine egne udlæg ───────────────────────────────────────────────────────────
$mineRows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
    'from'    => [['collectionId' => 'udlaeg']],
    'where'   => ['fieldFilter' => [
        'field' => ['fieldPath' => 'afsenderUid'],
        'op'    => 'EQUAL',
        'value' => ['stringValue' => $uid],
    ]],
    'orderBy' => [['field' => ['fieldPath' => 'indsendt'], 'direction' => 'DESCENDING']],
    'limit'   => 50,
]]);

$mine = [];
foreach ($mineRows as $r) {
    if (!isset($r['document'])) continue;
    $mine[] = fmt_udlaeg($r['document']);
}

// ── Til godkendelse (formand-view) ────────────────────────────────────────────
$tilGodkendelse = [];
if ($email) {
    $configDoc  = fs_get("{$base}/settings/udlaeg_config", $fsToken);
    $config     = $configDoc['fields'] ?? [];
    $afdelinger = json_decode($config['afdelinger']['stringValue'] ?? '{}', true) ?: [];
    $hbEmail    = $config['hb_formand_email']['stringValue'] ?? '';

    // Formand for disse afdelinger
    $formandFor = [];
    foreach ($afdelinger as $afdId => $afd) {
        if (($afd['formand_email'] ?? '') === $email) $formandFor[] = $afdId;
    }

    // Formand-afventer_formand
    foreach ($formandFor as $afdNavn) {
        $rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
            'from'  => [['collectionId' => 'udlaeg']],
            'where' => ['compositeFilter' => ['op' => 'AND', 'filters' => [
                ['fieldFilter' => ['field' => ['fieldPath' => 'afdeling'], 'op' => 'EQUAL', 'value' => ['stringValue' => $afdNavn]]],
                ['fieldFilter' => ['field' => ['fieldPath' => 'status'],   'op' => 'EQUAL', 'value' => ['stringValue' => 'afventer_formand']]],
            ]]],
            'orderBy' => [['field' => ['fieldPath' => 'indsendt'], 'direction' => 'DESCENDING']],
            'limit'   => 50,
        ]]);
        foreach ($rows as $r) {
            if (!isset($r['document'])) continue;
            $tilGodkendelse[] = fmt_udlaeg($r['document']);
        }
    }

    // HB-formand ser afventer_hb
    if ($hbEmail && $email === $hbEmail) {
        $rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
            'from'    => [['collectionId' => 'udlaeg']],
            'where'   => ['fieldFilter' => ['field' => ['fieldPath' => 'status'], 'op' => 'EQUAL', 'value' => ['stringValue' => 'afventer_hb']]],
            'orderBy' => [['field' => ['fieldPath' => 'indsendt'], 'direction' => 'DESCENDING']],
            'limit'   => 50,
        ]]);
        foreach ($rows as $r) {
            if (!isset($r['document'])) continue;
            $tilGodkendelse[] = fmt_udlaeg($r['document']);
        }
    }
}

echo json_encode(['mine' => $mine, 'tilGodkendelse' => $tilGodkendelse], JSON_UNESCAPED_UNICODE);
