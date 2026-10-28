<?php
/**
 * Send tilkendegivelse-mail/SMS til alle deltagere.
 *
 * POST  Authorization: Bearer <token>
 *       { tilkendegivelseId: "abc", holdId: "12345", kanal: "mail"|"sms"|"begge" }
 *
 * Returnerer: { ok: true, sendt: N, fejlet: M }
 *
 * Sætter status → 'udsendt' hvis mindst én besked kom frem.
 */

require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_send_helpers.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

set_time_limit(120);

$auth         = trainer_auth();
$uid          = $auth['uid'];
$email        = $auth['email'];
$conventus_id = $auth['conventus_id'];
$fsToken      = $auth['fsToken'];
$projectId    = $auth['projectId'];
$base         = $auth['base'];

$body              = json_decode(file_get_contents('php://input'), true) ?? [];
$tilkendegivelseId = trim((string)($body['tilkendegivelseId'] ?? ''));
$holdId            = trim((string)($body['holdId']            ?? ''));
$kanal             = trim((string)($body['kanal']             ?? 'mail'));

if (!$tilkendegivelseId || !$holdId) {
    http_response_code(400); echo json_encode(['error' => 'tilkendegivelseId og holdId er påkrævet']); exit;
}
if (!in_array($kanal, ['mail', 'sms', 'begge'], true)) {
    http_response_code(400); echo json_encode(['error' => 'Ugyldig kanal']); exit;
}

$tc = trainer_app_config($base, $fsToken);

if ($tc['testMode']) {
    if (in_array($kanal, ['mail', 'begge'], true) && $tc['testEmail'] === '') {
        http_response_code(500);
        echo json_encode(['error' => 'Testtilstand er aktiv men testmail er ikke konfigureret i backoffice']);
        exit;
    }
    if (in_array($kanal, ['sms', 'begge'], true) && $tc['testPhone'] === '') {
        http_response_code(500);
        echo json_encode(['error' => 'Testtilstand er aktiv men testtelefon er ikke konfigureret i backoffice']);
        exit;
    }
}

$lederHolds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHolds[$holdId])) { http_response_code(403); echo json_encode(['error' => 'Ingen adgang']); exit; }

$doc = fs_get("{$base}/tilkendegivelser/{$tilkendegivelseId}", $fsToken);
if (!$doc || ($doc['fields']['holdId']['stringValue'] ?? '') !== $holdId) {
    http_response_code(404); echo json_encode(['error' => 'Tilkendegivelse ikke fundet']); exit;
}
$f = $doc['fields'];

$titel = $f['titel']['stringValue'] ?? '';
$besked = $f['besked']['stringValue'] ?? '';

$datoer = [];
foreach ($f['datoer']['arrayValue']['values'] ?? [] as $d) {
    $df = $d['mapValue']['fields'] ?? [];
    $datoer[] = [
        'dato'      => $df['dato']['stringValue']      ?? '',
        'tidspunkt' => $df['tidspunkt']['stringValue'] ?? '',
        'modetid'   => $df['modetid']['stringValue']   ?? '',
        'sted'      => $df['sted']['stringValue']      ?? '',
    ];
}

$holdDoc   = fs_get("{$base}/holds/{$holdId}", $fsToken);
$holdTitel = $holdDoc ? ($holdDoc['fields']['titel']['stringValue'] ?? "Hold {$holdId}") : "Hold {$holdId}";

$senderNavn = '';
if ($conventus_id) {
    $m = fs_get("{$base}/members/{$conventus_id}", $fsToken);
    $senderNavn = $m ? ($m['fields']['name']['stringValue'] ?? '') : '';
}

// Hent alle deltagere med deres svarToken
$deltDocs = fs_list("{$base}/tilkendegivelser/{$tilkendegivelseId}/deltagere", $fsToken);

$deltagere = [];
foreach ($deltDocs as $d) {
    if (!isset($d['fields'])) continue;
    $memberId = basename($d['name'] ?? '');
    $token    = $d['fields']['svarToken']['stringValue'] ?? '';
    $navn     = $d['fields']['navn']['stringValue']      ?? '';
    if ($memberId && $token) {
        $deltagere[] = ['id' => $memberId, 'navn' => $navn, 'token' => $token];
    }
}

$sendt = 0; $fejlet = 0;

// ── Send mail ─────────────────────────────────────────────────────────────────
if (in_array($kanal, ['mail', 'begge'], true)) {
    foreach ($deltagere as $deltager) {
        $memberDoc = fs_get("{$base}/members/{$deltager['id']}", $fsToken);
        $to = '';
        foreach ($memberDoc['fields']['allEmails']['arrayValue']['values'] ?? [] as $v) {
            $em = strtolower(trim($v['stringValue'] ?? ''));
            if ($em && filter_var($em, FILTER_VALIDATE_EMAIL)) { $to = $em; break; }
        }
        if (!$to) continue;

        if ($tc['testMode']) {
            $to      = $tc['testEmail'];
            $subject = "[TEST → {$deltager['navn']}] {$titel} — {$holdTitel}";
        } else {
            $subject = "{$titel} — {$holdTitel}";
        }

        $html = byg_tilkendegivelse_mail($deltager['navn'], $titel, $datoer, $besked, $deltager['token'], $holdTitel);

        if (smtp_send_html($to, $subject, $html)) { $sendt++; } else { $fejlet++; }
    }

    log_udsendelse($projectId, $fsToken, [
        'channel'      => 'email',
        'senderUid'    => $uid,
        'senderName'   => $senderNavn,
        'holdId'       => $holdId,
        'holdTitel'    => $holdTitel,
        'begivenhedId' => $tilkendegivelseId,
        'scope'        => "tilkendegivelse:{$tilkendegivelseId}",
        'recipients'   => count($deltagere),
        'sendt'        => $sendt,
        'fejlet'       => $fejlet,
        'testMode'     => $tc['testMode'],
    ]);
}

// ── Send SMS ──────────────────────────────────────────────────────────────────
$smsSendt = 0; $smsFejlet = 0;

if (in_array($kanal, ['sms', 'begge'], true)) {
    $smsKey = getenv('SMS_API_KEY') ?: '';
    if (!$smsKey) {
        http_response_code(503);
        echo json_encode(['error' => 'SMS_API_KEY er ikke konfigureret']);
        exit;
    }

    $phoneMap = hent_conventus_telefonmap(getenv('CONVENTUS_KEY') ?: '');

    $datoListe = implode(', ', array_column($datoer, 'dato'));
    foreach ($deltagere as $deltager) {
        $msisdn = $phoneMap[$deltager['id']] ?? null;
        if (!$msisdn) continue;

        $svarUrl = 'https://app.sejssvejbaek-if.dk/s/' . rawurlencode($deltager['token']);
        $smsText = "{$titel}: {$datoListe}. Svar her: {$svarUrl}";

        if ($tc['testMode']) {
            $msisdn  = conventus_msisdn_til_int($tc['testPhone']);
            $smsText = "[TEST→{$deltager['navn']}] {$smsText}";
        }

        if (!$msisdn) continue;

        $gwResp = @file_get_contents('https://gatewayapi.com/rest/mtsms', false, stream_context_create(['http' => [
            'method'        => 'POST',
            'header'        => "Authorization: Token {$smsKey}\r\nContent-Type: application/json\r\n",
            'content'       => json_encode(['sender' => sms_afsender($holdTitel), 'message' => $smsText,
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
        'senderUid'     => $uid,
        'senderName'    => $senderNavn,
        'holdId'        => $holdId,
        'holdTitel'     => $holdTitel,
        'begivenhedId'  => $tilkendegivelseId,
        'scope'         => "tilkendegivelse:{$tilkendegivelseId}",
        'recipients'    => count($deltagere),
        'sendt'         => $smsSendt,
        'fejlet'        => $smsFejlet,
        'parts'         => $smsParts,
        'estimatedCost' => $kostDkk,
        'testMode'      => $tc['testMode'],
    ]);
    $sendt  += $smsSendt;
    $fejlet += $smsFejlet;
}

// Opdatér status → 'udsendt'
if ($sendt > 0) {
    $now  = date('Y-m-d\TH:i:s\Z');
    $mask = 'updateMask.fieldPaths=status&updateMask.fieldPaths=udsendt_at';
    @file_get_contents("{$base}/tilkendegivelser/{$tilkendegivelseId}?{$mask}", false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => [
            'status'     => ['stringValue' => 'udsendt'],
            'udsendt_at' => ['timestampValue' => $now],
        ]]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
}

echo json_encode(['ok' => true, 'sendt' => $sendt, 'fejlet' => $fejlet]);
