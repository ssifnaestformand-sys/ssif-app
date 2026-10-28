<?php
/**
 * Sender automatiske påmindelser til deltagere uden svar.
 *
 * POST  X-Sync-Secret: {SYNC_SECRET}
 *
 * Køres hvert time via GitHub Actions (pamindelser.yml).
 * Finder begivenheder med pamindelse.sendt == false og
 * pamindelse.tidspunkt <= nu, og sender mail/SMS til udtagne
 * deltagere der endnu ikke har svaret.
 *
 * Returnerer: { behandlet: N, sendt: M, fejl: [...] }
 */

require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_send_helpers.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$syncSecret = getenv('SYNC_SECRET') ?: '';
$reqSecret  = $_SERVER['HTTP_X_SYNC_SECRET'] ?? '';
if (!$syncSecret || !hash_equals($syncSecret, $reqSecret)) {
    http_response_code(403);
    echo json_encode(['error' => 'Ugyldig X-Sync-Secret']);
    exit;
}

set_time_limit(300);

// Hent service account og lav Firestore-token
$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) { http_response_code(503); echo json_encode(['error' => 'Konfigurationsfejl']); exit; }
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];
$fsToken   = make_fs_token($sa);
if (!$fsToken) { http_response_code(503); echo json_encode(['error' => 'Kunne ikke hente Firestore-token']); exit; }

$base         = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents";
$resourceBase = "projects/{$projectId}/databases/(default)/documents";
$now          = date('Y-m-d\TH:i:s\Z');

$tc = trainer_app_config($base, $fsToken);

// Testtilstand-validering
if ($tc['testMode']) {
    if ($tc['testEmail'] === '' || $tc['testPhone'] === '') {
        http_response_code(500);
        echo json_encode(['error' => 'Testtilstand er aktiv men testmail/testtelefon er ikke konfigureret i backoffice']);
        exit;
    }
}

// Hent begivenheder med pamindelse.sendt == false
$rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
    'from'  => [['collectionId' => 'begivenheder']],
    'where' => ['fieldFilter' => [
        'field' => ['fieldPath' => 'pamindelse.sendt'],
        'op'    => 'EQUAL',
        'value' => ['booleanValue' => false],
    ]],
]]);

$behandlet = 0;
$totalSendt = 0;
$fejl = [];

foreach ($rows as $row) {
    if (!isset($row['document']['fields'])) continue;
    $f           = $row['document']['fields'];
    $begivenhedId = basename($row['document']['name'] ?? '');
    if (!$begivenhedId) continue;

    // Tjek at pamindelsestidspunktet er nået
    $pamFields = $f['pamindelse']['mapValue']['fields'] ?? null;
    if (!$pamFields) continue;
    $tidspunkt = $pamFields['tidspunkt']['stringValue'] ?? '';
    if (!$tidspunkt) continue;
    if (strtotime($tidspunkt) > time()) continue; // endnu ikke tid

    $kanal     = $pamFields['kanal']['stringValue'] ?? 'mail';
    $holdId    = $f['holdId']['stringValue'] ?? '';
    $type      = $f['type']['stringValue']   ?? '';
    $titel     = $f['titel']['stringValue']  ?? '';
    $dato      = $f['dato']['stringValue']   ?? '';
    $tidBev    = $f['tidspunkt']['stringValue'] ?? '';
    $modetid   = $f['modetid']['stringValue']  ?? '';
    $sted      = $f['sted']['stringValue']     ?? '';
    $beskrivelse = $f['beskrivelse']['stringValue'] ?? '';

    // Begivenhed skal ikke være afholdt
    if ($dato && strtotime($dato . ' 23:59:59') < time()) {
        // Marker sendt uden faktisk at sende (begivenheden er forbi)
        @file_get_contents("{$base}/begivenheder/{$begivenhedId}?updateMask.fieldPaths=pamindelse.sendt", false, stream_context_create(['http' => [
            'method'        => 'PATCH',
            'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
            'content'       => json_encode(['fields' => ['pamindelse' => ['mapValue' => ['fields' => array_merge($pamFields, ['sendt' => ['booleanValue' => true]])]]]]),
            'timeout'       => 10,
            'ignore_errors' => true,
        ]]));
        continue;
    }

    $datoDk = dato_dk($dato);

    // Hold-titel til log
    $holdDoc   = fs_get("{$base}/holds/{$holdId}", $fsToken);
    $holdTitel = $holdDoc ? ($holdDoc['fields']['titel']['stringValue'] ?? "Hold {$holdId}") : "Hold {$holdId}";

    // Hent udtagne deltagere uden svar
    $deltagerDocs = fs_list("{$base}/begivenheder/{$begivenhedId}/deltagere", $fsToken);
    $ikkesvaret = [];
    foreach ($deltagerDocs as $d) {
        $df = $d['fields'] ?? [];
        if (($df['udtaget']['booleanValue'] ?? false) !== true) continue;
        if (($df['svar']['stringValue'] ?? '') !== '') continue; // har allerede svaret
        $memberId = basename($d['name']);
        $token    = $df['svarToken']['stringValue'] ?? '';
        $navn     = $df['navn']['stringValue'] ?? '';
        if ($memberId && $token) {
            $ikkesvaret[] = ['id' => $memberId, 'navn' => $navn, 'token' => $token];
        }
    }

    if (empty($ikkesvaret)) {
        // Alle har svaret — marker sendt uden at sende
        patch_pamindelse_sendt($base, $begivenhedId, $fsToken, $pamFields);
        $behandlet++;
        continue;
    }

    $sendt = 0; $fejlet = 0;

    // ── Mail-påmindelser ──────────────────────────────────────────────────────
    if (in_array($kanal, ['mail', 'begge'], true)) {
        foreach ($ikkesvaret as $deltager) {
            $memberDoc = fs_get("{$base}/members/{$deltager['id']}", $fsToken);
            $to = '';
            foreach ($memberDoc['fields']['allEmails']['arrayValue']['values'] ?? [] as $v) {
                $em = strtolower(trim($v['stringValue'] ?? ''));
                if ($em && filter_var($em, FILTER_VALIDATE_EMAIL)) { $to = $em; break; }
            }
            if (!$to) continue;

            $subject = $tc['testMode']
                ? "[TEST → {$deltager['navn']}] Påmindelse: {$titel}"
                : "Påmindelse — du mangler at svare på {$titel}";
            if ($tc['testMode']) $to = $tc['testEmail'];

            $html = byg_mail_html($deltager['navn'], $type, $titel, $datoDk, $tidBev, $modetid, $sted, $beskrivelse, $deltager['token']);
            if (smtp_send_html($to, $subject, $html)) { $sendt++; } else { $fejlet++; }
        }

        log_udsendelse($projectId, $fsToken, [
            'channel'      => 'email',
            'senderUid'    => 'cron',
            'senderName'   => 'Automatisk påmindelse',
            'holdId'       => $holdId,
            'holdTitel'    => $holdTitel,
            'begivenhedId' => $begivenhedId,
            'scope'        => "pamindelse:{$begivenhedId}",
            'recipients'   => count($ikkesvaret),
            'sendt'        => $sendt,
            'fejlet'       => $fejlet,
            'testMode'     => $tc['testMode'],
        ]);
    }

    // ── SMS-påmindelser ───────────────────────────────────────────────────────
    $smsSendt = 0; $smsFejlet = 0;
    if (in_array($kanal, ['sms', 'begge'], true)) {
        $smsKey  = getenv('SMS_API_KEY') ?: '';
        $phoneMap = $smsKey ? hent_conventus_telefonmap(getenv('CONVENTUS_KEY') ?: '') : [];

        foreach ($ikkesvaret as $deltager) {
            $msisdn = $phoneMap[$deltager['id']] ?? null;
            if ($tc['testMode']) $msisdn = conventus_msisdn_til_int($tc['testPhone']);
            if (!$msisdn) continue;

            $svarUrl = 'https://app.sejssvejbaek-if.dk/s/' . rawurlencode($deltager['token']);
            $smsText = "Påmindelse: {$titel} {$datoDk} kl. {$tidBev}. Svar: {$svarUrl}";
            if ($tc['testMode']) $smsText = "[TEST→{$deltager['navn']}] {$smsText}";

            $gwResp = @file_get_contents('https://gatewayapi.com/rest/mtsms', false, stream_context_create(['http' => [
                'method'        => 'POST',
                'header'        => "Authorization: Token {$smsKey}\r\nContent-Type: application/json\r\n",
                'content'       => json_encode(['sender' => 'SSIF', 'message' => $smsText,
                                                'recipients' => [['msisdn' => $msisdn]]]),
                'timeout'       => 10,
                'ignore_errors' => true,
            ]]));
            $gwData = json_decode($gwResp ?: '{}', true);
            if (isset($gwData['ids']) && !isset($gwData['code'])) { $smsSendt++; } else { $smsFejlet++; }
        }

        $smsParts = sms_parts_bev($smsText ?? '');
        $kostDkk  = round($smsSendt * $smsParts * 0.29, 2);
        log_udsendelse($projectId, $fsToken, [
            'channel'       => 'sms',
            'senderUid'     => 'cron',
            'senderName'    => 'Automatisk påmindelse',
            'holdId'        => $holdId,
            'holdTitel'     => $holdTitel,
            'begivenhedId'  => $begivenhedId,
            'scope'         => "pamindelse:{$begivenhedId}",
            'recipients'    => count($ikkesvaret),
            'sendt'         => $smsSendt,
            'fejlet'        => $smsFejlet,
            'parts'         => $smsParts,
            'estimatedCost' => $kostDkk,
            'testMode'      => $tc['testMode'],
        ]);
        $sendt  += $smsSendt;
        $fejlet += $smsFejlet;
    }

    // Marker påmindelsen som sendt
    patch_pamindelse_sendt($base, $begivenhedId, $fsToken, $pamFields);

    $behandlet++;
    $totalSendt += $sendt;
    if ($fejlet > 0) $fejl[] = "{$begivenhedId}: {$fejlet} fejl";
}

echo json_encode(['behandlet' => $behandlet, 'sendt' => $totalSendt, 'fejl' => $fejl]);

// ── Hjælper ───────────────────────────────────────────────────────────────────

function patch_pamindelse_sendt(string $base, string $begivenhedId, string $fsToken, array $pamFields): void {
    $updFields = array_merge($pamFields, ['sendt' => ['booleanValue' => true]]);
    $patchUrl  = "{$base}/begivenheder/{$begivenhedId}"
               . '?updateMask.fieldPaths=pamindelse.sendt'
               . '&updateMask.fieldPaths=pamindelse.tidspunkt'
               . '&updateMask.fieldPaths=pamindelse.kanal';
    @file_get_contents($patchUrl, false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => ['pamindelse' => ['mapValue' => ['fields' => $updFields]]]]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
}
