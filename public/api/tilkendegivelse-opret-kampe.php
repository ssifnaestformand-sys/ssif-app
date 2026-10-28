<?php
/**
 * Opret begivenheder fra en fordeling og send info/RSVP til spillerne.
 *
 * POST  Authorization: Bearer <token>
 * {
 *   tilkendegivelseId: "abc",
 *   holdId: "12345",
 *   dato: "2026-11-09",
 *   kanal: "mail"|"sms"|"begge",
 *   kampe: [
 *     {
 *       titel: "U12 Pulje 1",
 *       tidspunkt: "10:00",
 *       modetid: "09:30",
 *       sted: "Hjemmebane",
 *       kræverSvar: false,
 *       spillerIds: ["12345", "67890"],
 *       spillerNavne: { "12345": "Emil", "67890": "Lucas" }
 *     }, ...
 *   ]
 * }
 *
 * Returnerer: { ok: true, begivenhedIds: ["id1","id2",...], sendt: N, fejlet: M }
 */

require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_send_helpers.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

set_time_limit(180);

$auth         = trainer_auth();
$uid          = $auth['uid'];
$email        = $auth['email'];
$conventus_id = $auth['conventus_id'];
$fsToken      = $auth['fsToken'];
$projectId    = $auth['projectId'];
$base         = $auth['base'];
$resourceBase = $auth['resourceBase'];

$body              = json_decode(file_get_contents('php://input'), true) ?? [];
$tilkendegivelseId = trim((string)($body['tilkendegivelseId'] ?? ''));
$holdId            = trim((string)($body['holdId']            ?? ''));
$dato              = trim((string)($body['dato']              ?? ''));
$kanal             = trim((string)($body['kanal']             ?? 'mail'));
$kampe             = is_array($body['kampe'] ?? null) ? $body['kampe'] : [];

if (!$tilkendegivelseId || !$holdId || !$dato || empty($kampe)) {
    http_response_code(400); echo json_encode(['error' => 'Manglende påkrævede felter']); exit;
}
if (!in_array($kanal, ['mail', 'sms', 'begge'], true)) {
    http_response_code(400); echo json_encode(['error' => 'Ugyldig kanal']); exit;
}

$tc = trainer_app_config($base, $fsToken);

$lederHolds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHolds[$holdId])) { http_response_code(403); echo json_encode(['error' => 'Ingen adgang']); exit; }

$tDoc = fs_get("{$base}/tilkendegivelser/{$tilkendegivelseId}", $fsToken);
if (!$tDoc || ($tDoc['fields']['holdId']['stringValue'] ?? '') !== $holdId) {
    http_response_code(404); echo json_encode(['error' => 'Tilkendegivelse ikke fundet']); exit;
}

$holdDoc   = fs_get("{$base}/holds/{$holdId}", $fsToken);
$holdTitel = $holdDoc ? ($holdDoc['fields']['titel']['stringValue'] ?? "Hold {$holdId}") : "Hold {$holdId}";

$senderNavn = '';
if ($conventus_id) {
    $m = fs_get("{$base}/members/{$conventus_id}", $fsToken);
    $senderNavn = $m ? ($m['fields']['name']['stringValue'] ?? '') : '';
}

$phoneMap = [];
if (in_array($kanal, ['sms', 'begge'], true)) {
    $phoneMap = hent_conventus_telefonmap(getenv('CONVENTUS_KEY') ?: '');
}

$datoDk       = dato_dk($dato);
$now          = date('Y-m-d\TH:i:s\Z');
$begivenhedIds = [];
$sendt        = 0;
$fejlet       = 0;

foreach ($kampe as $kamp) {
    $kTitel      = trim((string)($kamp['titel']      ?? ''));
    $kTidspunkt  = trim((string)($kamp['tidspunkt']  ?? ''));
    $kMotetid    = trim((string)($kamp['modetid']    ?? ''));
    $kSted       = trim((string)($kamp['sted']       ?? ''));
    $kræverSvar  = (bool)($kamp['kræverSvar']        ?? false);
    $spillerIds  = is_array($kamp['spillerIds']  ?? null) ? $kamp['spillerIds'] : [];
    $spillerNavne = is_array($kamp['spillerNavne'] ?? null) ? $kamp['spillerNavne'] : [];

    if (!$kTitel || empty($spillerIds)) continue;

    $bevFields = [
        'holdId'      => ['stringValue' => $holdId],
        'type'        => ['stringValue' => 'kamp'],
        'titel'       => ['stringValue' => $kTitel],
        'dato'        => ['stringValue' => $dato],
        'tidspunkt'   => $kTidspunkt ? ['stringValue' => $kTidspunkt] : ['nullValue' => null],
        'modetid'     => $kMotetid   ? ['stringValue' => $kMotetid]  : ['nullValue' => null],
        'sted'        => $kSted      ? ['stringValue' => $kSted]     : ['nullValue' => null],
        'beskrivelse' => ['nullValue' => null],
        'status'      => ['stringValue' => 'kladde'],
        'oprettetAf'  => ['stringValue' => $uid],
        'oprettetAt'  => ['timestampValue' => $now],
        'kildeId'     => ['stringValue' => $tilkendegivelseId],
    ];

    $bevId = fs_create($projectId, $fsToken, 'begivenheder', $bevFields);
    if (!$bevId) continue;

    $begivenhedIds[] = $bevId;

    // Byg deltager-docs + evt. svarlinks
    $writes = [];
    foreach ($spillerIds as $spillerId) {
        $spillerNavn = $spillerNavne[(string)$spillerId] ?? '';
        $token       = $kræverSvar ? bin2hex(random_bytes(16)) : '';

        $deltFields = [
            'navn'    => ['stringValue' => (string)$spillerNavn],
            'udtaget' => ['booleanValue' => true],
        ];
        if ($kræverSvar && $token) {
            $deltFields['svarToken'] = ['stringValue' => $token];
            $deltFields['svar']      = ['nullValue'  => null];
        }
        $writes[] = ['update' => [
            'name'   => "{$resourceBase}/begivenheder/{$bevId}/deltagere/{$spillerId}",
            'fields' => $deltFields,
        ]];
        if ($kræverSvar && $token) {
            $writes[] = ['update' => [
                'name'   => "{$resourceBase}/svarlinks/{$token}",
                'fields' => [
                    'begivenhedId' => ['stringValue' => $bevId],
                    'memberId'     => ['stringValue' => (string)$spillerId],
                ],
            ]];
        }
    }
    if (!empty($writes)) fs_commit($projectId, $fsToken, $writes);

    // Send mails til spillerne
    if (in_array($kanal, ['mail', 'begge'], true)) {
        $kSendt = 0; $kFejlet = 0;
        foreach ($spillerIds as $spillerId) {
            $memberDoc = fs_get("{$base}/members/{$spillerId}", $fsToken);
            $to = '';
            foreach ($memberDoc['fields']['allEmails']['arrayValue']['values'] ?? [] as $v) {
                $em = strtolower(trim($v['stringValue'] ?? ''));
                if ($em && filter_var($em, FILTER_VALIDATE_EMAIL)) { $to = $em; break; }
            }
            if (!$to) continue;

            $spillerNavn = $spillerNavne[(string)$spillerId] ?? '';

            if ($tc['testMode']) {
                $to      = $tc['testEmail'];
                $subject = "[TEST → {$spillerNavn}] Du er udtaget til {$kTitel} — {$holdTitel}";
            } else {
                $subject = "Du er udtaget til {$kTitel} — {$holdTitel}";
            }

            // Find svarToken for denne spiller (vi oprettede den ovenfor)
            $svarToken = '';
            foreach ($writes as $w) {
                if (isset($w['update']['name']) && str_ends_with($w['update']['name'], "/deltagere/{$spillerId}")) {
                    $svarToken = $w['update']['fields']['svarToken']['stringValue'] ?? '';
                }
            }

            if ($kræverSvar && $svarToken) {
                $html = byg_mail_html($spillerNavn, 'kamp', $kTitel, $datoDk, $kTidspunkt, $kMotetid, $kSted, '', $svarToken, $holdTitel);
            } else {
                $html = byg_info_mail_html($spillerNavn, $kTitel, $datoDk, $kTidspunkt, $kMotetid, $kSted, '', $holdTitel);
            }

            if (smtp_send_html($to, $subject, $html)) { $kSendt++; $sendt++; } else { $kFejlet++; $fejlet++; }
        }

        log_udsendelse($projectId, $fsToken, [
            'channel'      => 'email',
            'senderUid'    => $uid,
            'senderName'   => $senderNavn,
            'holdId'       => $holdId,
            'holdTitel'    => $holdTitel,
            'begivenhedId' => $bevId,
            'scope'        => "fordeling:{$tilkendegivelseId}:{$bevId}",
            'recipients'   => count($spillerIds),
            'sendt'        => $kSendt,
            'fejlet'       => $kFejlet,
            'testMode'     => $tc['testMode'],
        ]);
    }

    // Send SMS
    if (in_array($kanal, ['sms', 'begge'], true)) {
        $smsKey = getenv('SMS_API_KEY') ?: '';
        $kSmsSendt = 0; $kSmsFejlet = 0;
        if ($smsKey) {
            foreach ($spillerIds as $spillerId) {
                $msisdn      = $phoneMap[(string)$spillerId] ?? null;
                $spillerNavn = $spillerNavne[(string)$spillerId] ?? '';
                if (!$msisdn) continue;

                $smsText = "{$kTitel} {$datoDk} kl. {$kTidspunkt}.";
                if ($kSted) $smsText .= " Sted: {$kSted}.";

                if ($tc['testMode']) {
                    $msisdn  = conventus_msisdn_til_int($tc['testPhone']);
                    $smsText = "[TEST→{$spillerNavn}] {$smsText}";
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
                if (isset($gwData['ids']) && !isset($gwData['code'])) { $kSmsSendt++; $sendt++; } else { $kSmsFejlet++; $fejlet++; }
            }
            $smsParts = sms_parts_bev($smsText ?? '');
            log_udsendelse($projectId, $fsToken, [
                'channel'       => 'sms',
                'senderUid'     => $uid,
                'senderName'    => $senderNavn,
                'holdId'        => $holdId,
                'holdTitel'     => $holdTitel,
                'begivenhedId'  => $bevId,
                'scope'         => "fordeling:{$tilkendegivelseId}:{$bevId}",
                'recipients'    => count($spillerIds),
                'sendt'         => $kSmsSendt,
                'fejlet'        => $kSmsFejlet,
                'parts'         => $smsParts,
                'estimatedCost' => round($kSmsSendt * $smsParts * 0.29, 2),
                'testMode'      => $tc['testMode'],
            ]);
        }
    }
}

// Markér tilkendegivelse som lukket
if (!empty($begivenhedIds)) {
    $mask = 'updateMask.fieldPaths=status';
    @file_get_contents("{$base}/tilkendegivelser/{$tilkendegivelseId}?{$mask}", false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => ['status' => ['stringValue' => 'lukket']]]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
}

echo json_encode(['ok' => true, 'begivenhedIds' => $begivenhedIds, 'sendt' => $sendt, 'fejlet' => $fejlet]);
