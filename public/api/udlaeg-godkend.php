<?php
/**
 * Godkend et udlæg.
 *
 * POST {
 *   udlaegId:     string,
 *   kontering:    string,  // kontonummer eller '__bogholder__'
 *   konteringNavn:string,
 * }
 *
 * Validerer at godkenderen er formand for den pågældende afdeling (eller HB-formand
 * ved afventer_hb). Sender bogholder-mail med bankoplysninger, sletter udlaeg_bank.
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
$allEmails  = $auth['allEmails'];
$displayName = $auth['displayName'] ?: $email;
$fsToken    = $auth['fsToken'];
$projectId  = $auth['projectId'];
$base       = $auth['base'];

$raw          = json_decode(file_get_contents('php://input'), true) ?: [];
$udlaegId     = trim($raw['udlaegId']      ?? '');
$kontering    = trim($raw['kontering']     ?? '');
$konteringNavn= trim($raw['konteringNavn'] ?? '');

if (!$udlaegId)  { http_response_code(400); echo json_encode(['error' => 'udlaegId mangler']); exit; }
if (!$kontering) { http_response_code(400); echo json_encode(['error' => 'Kontering mangler']); exit; }

// ── Hent udlæg og config ──────────────────────────────────────────────────────
$udlaegDoc = fs_get("{$base}/udlaeg/{$udlaegId}", $fsToken);
if (!$udlaegDoc) { http_response_code(404); echo json_encode(['error' => 'Udlæg ikke fundet']); exit; }
$uf = $udlaegDoc['fields'];

$configDoc  = fs_get("{$base}/settings/udlaeg_config", $fsToken);
$config     = $configDoc['fields'] ?? [];
$afdelinger = json_decode($config['afdelinger']['stringValue'] ?? '{}', true) ?: [];
$hbEmail    = $config['hb_formand_email']['stringValue'] ?? '';
$bogholderEmail = $config['bogholder_email']['stringValue'] ?? '';
$godkGraense = (int)($config['godkendelse_graense']['integerValue'] ?? 100000);

$afdeling            = $uf['afdeling']['stringValue']      ?? '';
$status              = $uf['status']['stringValue']        ?? '';
$formandEmail        = strtolower($afdelinger[$afdeling]['formand_email'] ?? '');
$hbEmail             = strtolower($hbEmail);
$godkenderEmailOverride = strtolower(trim($uf['godkenderEmail']['stringValue'] ?? ''));

// ── Autorisationstjek ─────────────────────────────────────────────────────────
// godkenderEmail-feltet (sat af admin via videresend) har forrang frem for
// afdelingens konfigurerede formand_email.
$erTildelteGodkender = $godkenderEmailOverride && in_array($godkenderEmailOverride, $allEmails, true);
$erFormand = in_array($formandEmail, $allEmails, true) || $erTildelteGodkender;
$erHB      = in_array($hbEmail,      $allEmails, true) || $erTildelteGodkender;

$maaGodkende = ($status === 'afventer_formand' && $erFormand)
            || ($status === 'afventer_hb'      && $erHB);

if (!$maaGodkende) {
    http_response_code(403);
    echo json_encode(['error' => 'Du har ikke ret til at godkende dette udlæg']);
    exit;
}

$belob = (float)($uf['belob']['doubleValue'] ?? $uf['belob']['integerValue'] ?? 0);
$now   = date('Y-m-d\TH:i:s\Z');

// ── Afgør nyt status ──────────────────────────────────────────────────────────
if ($status === 'afventer_formand' && $belob > $godkGraense && $hbEmail) {
    // Over grænsen → videre til HB-formand
    $nytStatus = 'afventer_hb';
    $doSendBogholder = false;
} else {
    $nytStatus = 'godkendt';
    $doSendBogholder = true;
}

// ── Opdatér udlæg i Firestore ────────────────────────────────────────────────
$updateFields = [
    'status'        => ['stringValue'    => $nytStatus],
    'kontering'     => ['stringValue'    => $kontering],
    'konteringNavn' => ['stringValue'    => $konteringNavn],
    'godkendtAf'    => ['stringValue'    => $displayName],
    'godkendtAt'    => ['timestampValue' => $now],
];
$updateMask = implode('&', array_map(fn($k) => 'updateMask.fieldPaths=' . urlencode($k), array_keys($updateFields)));
@file_get_contents("{$base}/udlaeg/{$udlaegId}?{$updateMask}", false, stream_context_create(['http' => [
    'method'        => 'PATCH',
    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode(['fields' => $updateFields]),
    'timeout'       => 10,
    'ignore_errors' => true,
]]));

if ($nytStatus === 'afventer_hb' && $hbEmail) {
    // Send notifikation til HB-formand
    $mailData = [
        'afsenderNavn' => $uf['afsenderNavn']['stringValue'] ?? '',
        'afdeling'     => $afdeling,
        'belob'        => $belob,
        'beskrivelse'  => $uf['beskrivelse']['stringValue']  ?? '',
        'kvitteringUrl'=> $uf['kvitteringUrl']['stringValue']?? '',
    ];
    smtp_send_html($hbEmail, 'Udlæg over beløbsgrænse afventer HB-godkendelse — ' . $afdeling, byg_udlaeg_notif_html($mailData));
    echo json_encode(['ok' => true, 'status' => 'afventer_hb'], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Endelig godkendelse: hent bankoplysninger og send til bogholder ───────────
$bankDoc = fs_get("https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/udlaeg_bank/{$udlaegId}", $fsToken);
$bankF   = $bankDoc['fields'] ?? [];
$regNr   = $bankF['regNr']['stringValue']   ?? '';
$kontoNr = $bankF['kontoNr']['stringValue']  ?? '';

if ($bogholderEmail && $doSendBogholder) {
    $bData = [
        'afsenderNavn'  => $uf['afsenderNavn']['stringValue']  ?? '',
        'afsenderEmail' => $uf['afsenderEmail']['stringValue'] ?? '',
        'afdeling'      => $afdeling,
        'belob'         => $belob,
        'beskrivelse'   => $uf['beskrivelse']['stringValue']   ?? '',
        'kontering'     => $kontering === '__bogholder__' ? '' : $kontering,
        'konteringNavn' => $kontering === '__bogholder__' ? '' : $konteringNavn,
        'kvitteringUrl' => $uf['kvitteringUrl']['stringValue'] ?? '',
        'regNr'         => $regNr,
        'kontoNr'       => $kontoNr,
        'indsendt'      => substr($uf['indsendt']['timestampValue'] ?? '', 0, 10),
    ];
    smtp_send_html($bogholderEmail, 'Udlæg klar til bogføring — ' . $afdeling, byg_udlaeg_bogholder_html($bData));
}

// ── Send bekræftelsesmail til afsender ────────────────────────────────────────
$afsenderEmail = $uf['afsenderEmail']['stringValue'] ?? '';
if ($afsenderEmail) {
    $gData = [
        'afdeling'    => $afdeling,
        'belob'       => $belob,
        'beskrivelse' => $uf['beskrivelse']['stringValue'] ?? '',
    ];
    smtp_send_html($afsenderEmail, 'Dit udlæg er godkendt', byg_udlaeg_godkendt_html($gData));
}

// ── Slet bankoplysninger (bankdokument slettes nu permanent) ──────────────────
@file_get_contents("https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/udlaeg_bank/{$udlaegId}", false,
    stream_context_create(['http' => [
        'method'        => 'DELETE',
        'header'        => "Authorization: Bearer {$fsToken}\r\n",
        'timeout'       => 5,
        'ignore_errors' => true,
    ]]));

// ── e-conomic (feature-gated) ─────────────────────────────────────────────────
$econAppToken = getenv('ECONOMIC_APP_SECRET_TOKEN') ?: '';
$econAgrToken = getenv('ECONOMIC_AGREEMENT_GRANT_TOKEN') ?: '';
$econResult   = null;

$supplierNr     = (int)($config['economic_supplier_nr']['integerValue']     ?? 0);
$paymentTermsNr = (int)($config['economic_payment_terms_nr']['integerValue'] ?? 0);

if ($econAppToken && $econAgrToken && $supplierNr && $kontering && $kontering !== '__bogholder__') {
    $invoiceBody = [
        'date'     => substr($now, 0, 10),
        'supplier' => ['supplierNumber' => $supplierNr],
        'lines'    => [[
            'lineNumber'   => 1,
            'description'  => substr($uf['beskrivelse']['stringValue'] ?? '', 0, 250),
            'quantity'     => 1,
            'unitNetPrice' => $belob,
            'account'      => ['accountNumber' => (int)$kontering],
        ]],
    ];
    if ($paymentTermsNr) $invoiceBody['paymentTerms'] = ['paymentTermsNumber' => $paymentTermsNr];
    $econRaw = @file_get_contents('https://restapi.e-conomic.com/supplier-invoices', false,
        stream_context_create(['http' => [
            'method'        => 'POST',
            'header'        => "X-AppSecretToken: {$econAppToken}\r\nX-AgreementGrantToken: {$econAgrToken}\r\nContent-Type: application/json\r\n",
            'content'       => json_encode($invoiceBody),
            'timeout'       => 15,
            'ignore_errors' => true,
        ]]));
    if ($econRaw) {
        $econResult = json_decode($econRaw, true);
    }
}

// ── Gem e-conomic-svar i Firestore ────────────────────────────────────────────
$econStatus    = 'skipped';
$econSvarStr   = '';
$econVoucherId = null;
if ($econAppToken && $econAgrToken && $supplierNr && $kontering && $kontering !== '__bogholder__') {
    if ($econResult && !isset($econResult['httpStatusCode'])) {
        $econStatus    = 'posted';
        $econVoucherId = $econResult['supplierInvoiceNumber'] ?? $econResult['voucherNumber'] ?? null;
        $econSvarStr   = substr(json_encode($econResult, JSON_UNESCAPED_UNICODE), 0, 800);
    } else {
        $econStatus  = 'error';
        $econSvarStr = substr(json_encode($econResult ?? ['raw' => substr($econRaw ?? '', 0, 400)], JSON_UNESCAPED_UNICODE), 0, 800);
    }
}
$econFields = ['econStatus' => ['stringValue' => $econStatus]];
if ($econSvarStr)   $econFields['econSvar']     = ['stringValue'  => $econSvarStr];
if ($econVoucherId) $econFields['econVoucherId'] = ['integerValue' => (string)$econVoucherId];
$econMask = implode('&', array_map(fn($k) => 'updateMask.fieldPaths=' . urlencode($k), array_keys($econFields)));
@file_get_contents("{$base}/udlaeg/{$udlaegId}?{$econMask}", false, stream_context_create(['http' => [
    'method'        => 'PATCH',
    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode(['fields' => $econFields]),
    'timeout'       => 5,
    'ignore_errors' => true,
]]));

echo json_encode([
    'ok'       => true,
    'status'   => 'godkendt',
    'economic' => $econStatus,
], JSON_UNESCAPED_UNICODE);
