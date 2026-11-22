<?php
/**
 * Udlæg-konfiguration til træner-appen.
 *
 * POST { } — kræver Bearer-token (Firebase ID-token for trainer/admin).
 *
 * Returnerer:
 *   {
 *     afdelinger: [{ id, navn }],          // kun afdelinger hvor brugeren er leder
 *     kontoplan: [{ nummer, navn }],       // fra e-conomic (cached) eller tom liste
 *     afventer: int,                       // antal udlæg afventende godkendelse (formand-view)
 *     erFormand: bool,                     // om brugeren er formand for mindst én afdeling
 *     godkendelsesgraense: int,            // beløbsgrænse for HB-godkendelse
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
$conventus  = $auth['conventus_id'];
$fsToken    = $auth['fsToken'];
$projectId  = $auth['projectId'];
$base       = $auth['base'];

// ── Hent udlæg_config ────────────────────────────────────────────────────────
$configDoc = fs_get("{$base}/settings/udlaeg_config", $fsToken);
$config    = $configDoc['fields'] ?? [];

$afdelingerRaw    = json_decode($config['afdelinger']['stringValue'] ?? '{}', true) ?: [];
$godkGraense      = (int)($config['godkendelse_graense']['integerValue'] ?? 100000);

// ── Find brugerens leder-holds og de tilknyttede afdelinger ──────────────────
$lederHoldIds = get_leder_holds($email, $conventus, $projectId, $fsToken);
$brugerAfdelinger = []; // [afdNavn => afdNavn]
$seenAfdIds       = []; // undgå dobbelt opslag

if (!empty($lederHoldIds)) {
    foreach (array_keys($lederHoldIds) as $holdId) {
        $holdDoc = fs_get("{$base}/holds/{$holdId}", $fsToken);
        if (!$holdDoc) continue;
        // holds gemmer afdelings-id som integerValue eller stringValue
        $afdId = (string)(
            $holdDoc['fields']['afdeling_id']['integerValue'] ??
            $holdDoc['fields']['afdeling_id']['stringValue']  ?? ''
        );
        if ($afdId === '' || isset($seenAfdIds[$afdId])) continue;
        $seenAfdIds[$afdId] = true;
        $afdDoc  = fs_get("{$base}/afdelinger/{$afdId}", $fsToken);
        if (!$afdDoc) continue;
        $afdNavn = $afdDoc['fields']['navn']['stringValue'] ?? '';
        if ($afdNavn) $brugerAfdelinger[$afdNavn] = $afdNavn;
    }
}

$afdelingerListe = [];
foreach ($brugerAfdelinger as $navn) {
    $afdelingerListe[] = ['id' => $navn, 'navn' => $navn];
}
usort($afdelingerListe, fn($a, $b) => strcmp($a['navn'], $b['navn']));

// ── Tjek om brugeren er formand for en afdeling ──────────────────────────────
$erFormand = false;
if ($email) {
    foreach ($afdelingerRaw as $afd) {
        if (strtolower($afd['formand_email'] ?? '') === $email) { $erFormand = true; break; }
    }
    // HB-formand
    if (!$erFormand && strtolower($config['hb_formand_email']['stringValue'] ?? '') === $email) {
        $erFormand = true;
    }
}

// ── Kontoplan fra e-conomic (cached i Firestore) ─────────────────────────────
$kontoplan = [];
$econAppToken = getenv('ECONOMIC_APP_SECRET_TOKEN') ?: '';
$econAgrToken = getenv('ECONOMIC_AGREEMENT_GRANT_TOKEN') ?: '';

if ($econAppToken && $econAgrToken) {
    $cacheDoc     = fs_get("{$base}/settings/economic_accounts_cache", $fsToken);
    $cacheFields  = $cacheDoc['fields'] ?? [];
    $cacheExpires = (int)($cacheFields['expiresAt']['integerValue'] ?? 0);
    $cacheData    = $cacheFields['data']['stringValue'] ?? '';

    if ($cacheExpires > time() && $cacheData) {
        $kontoplan = json_decode($cacheData, true) ?: [];
    } else {
        // Hent fra e-conomic
        $econRaw = @file_get_contents('https://restapi.e-conomic.com/accounts?pagesize=200', false,
            stream_context_create(['http' => [
                'method'        => 'GET',
                'header'        => "X-AppSecretToken: {$econAppToken}\r\nX-AgreementGrantToken: {$econAgrToken}\r\nContent-Type: application/json\r\n",
                'timeout'       => 10,
                'ignore_errors' => true,
            ]]));
        if ($econRaw) {
            $econData = json_decode($econRaw, true);
            foreach ($econData['collection'] ?? [] as $konto) {
                $nr   = (string)($konto['accountNumber'] ?? '');
                $navn = (string)($konto['name'] ?? '');
                if ($nr && $navn) {
                    $kontoplan[] = ['nummer' => $nr, 'navn' => $navn];
                }
            }
            // Gem cache i Firestore (24 timer)
            $cacheBody = json_encode(['fields' => [
                'data'      => ['stringValue'  => json_encode($kontoplan)],
                'expiresAt' => ['integerValue' => (string)(time() + 86400)],
            ]]);
            @file_get_contents("{$base}/settings/economic_accounts_cache", false,
                stream_context_create(['http' => [
                    'method'        => 'PATCH',
                    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
                    'content'       => $cacheBody,
                    'timeout'       => 5,
                    'ignore_errors' => true,
                ]]));
        }
    }
}

// ── Antal afventende godkendelser (formand-view) ──────────────────────────────
$afventer = 0;
if ($erFormand && $email) {
    $formandAfdelinger = [];
    foreach ($afdelingerRaw as $afdId => $afd) {
        if (strtolower($afd['formand_email'] ?? '') === $email) $formandAfdelinger[] = $afdId;
    }
    $erHB = strtolower($config['hb_formand_email']['stringValue'] ?? '') === $email;

    foreach ($formandAfdelinger as $afdNavn) {
        $rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
            'from'  => [['collectionId' => 'udlaeg']],
            'where' => ['compositeFilter' => ['op' => 'AND', 'filters' => [
                ['fieldFilter' => ['field' => ['fieldPath' => 'afdeling'],    'op' => 'EQUAL', 'value' => ['stringValue' => $afdNavn]]],
                ['fieldFilter' => ['field' => ['fieldPath' => 'status'],      'op' => 'EQUAL', 'value' => ['stringValue' => 'afventer_formand']]],
            ]]],
            'limit' => 100,
        ]]);
        foreach ($rows as $r) { if (isset($r['document'])) $afventer++; }
    }
    // HB-formand tæller afventer_hb
    if ($erHB) {
        $rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
            'from'  => [['collectionId' => 'udlaeg']],
            'where' => ['fieldFilter' => ['field' => ['fieldPath' => 'status'], 'op' => 'EQUAL', 'value' => ['stringValue' => 'afventer_hb']]],
            'limit' => 100,
        ]]);
        foreach ($rows as $r) { if (isset($r['document'])) $afventer++; }
    }
}

echo json_encode([
    'afdelinger'            => $afdelingerListe,
    'kontoplan'             => $kontoplan,
    'afventer'              => $afventer,
    'erFormand'             => $erFormand,
    'godkendelsesgraense'   => $godkGraense,
], JSON_UNESCAPED_UNICODE);
