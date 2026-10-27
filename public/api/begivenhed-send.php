<?php
/**
 * Send begivenhed-mail til udtagne deltagere.
 *
 * POST  Authorization: Bearer <token>
 *       { begivenhedId: "abc", kanal: "mail" }
 *
 * Returnerer: { ok: true, sendt: N, fejlet: M }
 *
 * Testtilstand: alle mails går til TEST_EMAIL med "[TEST → navn]" i emnet.
 * SMS aktiveres i Skive 5.
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
$resourceBase = $auth['resourceBase'];

$body         = json_decode(file_get_contents('php://input'), true) ?? [];
$begivenhedId = trim((string)($body['begivenhedId'] ?? ''));
$kanal        = trim((string)($body['kanal'] ?? 'mail'));

if (!$begivenhedId) { http_response_code(400); echo json_encode(['error' => 'begivenhedId mangler']); exit; }
if (!in_array($kanal, ['mail', 'sms', 'begge'], true)) { http_response_code(400); echo json_encode(['error' => 'Ugyldig kanal']); exit; }

// Testtilstand-validering: fejl hvis testmodtager mangler
if (is_test_mode()) {
    if (in_array($kanal, ['mail', 'begge'], true) && test_email() === '') {
        http_response_code(500);
        echo json_encode(['error' => 'Testtilstand er aktiv men TEST_EMAIL er ikke konfigureret']);
        exit;
    }
    if (in_array($kanal, ['sms', 'begge'], true) && test_phone() === '') {
        http_response_code(500);
        echo json_encode(['error' => 'Testtilstand er aktiv men TEST_PHONE er ikke konfigureret']);
        exit;
    }
}

// Hent begivenhed
$doc = fs_get("{$base}/begivenheder/{$begivenhedId}", $fsToken);
if (!$doc) { http_response_code(404); echo json_encode(['error' => 'Begivenhed ikke fundet']); exit; }
$f      = $doc['fields'];
$holdId = $f['holdId']['stringValue'] ?? '';

// Bekræft adgang
$lederHolds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHolds[$holdId])) { http_response_code(403); echo json_encode(['error' => 'Ingen adgang']); exit; }

// Hent hold-titel til log
$holdDoc   = fs_get("{$base}/holds/{$holdId}", $fsToken);
$holdTitel = $holdDoc ? ($holdDoc['fields']['titel']['stringValue'] ?? "Hold {$holdId}") : "Hold {$holdId}";

// Hent trænernavn til log
$senderNavn = '';
if ($conventus_id) {
    $m = fs_get("{$base}/members/{$conventus_id}", $fsToken);
    $senderNavn = $m ? ($m['fields']['name']['stringValue'] ?? '') : '';
}

// Hent udtagne deltagere
$deltagerDocs = fs_list("{$base}/begivenheder/{$begivenhedId}/deltagere", $fsToken);
$udtagne = [];
foreach ($deltagerDocs as $d) {
    if (($d['fields']['udtaget']['booleanValue'] ?? false) === true) {
        $memberId = basename($d['name']);
        $token    = $d['fields']['svarToken']['stringValue'] ?? '';
        $navn     = $d['fields']['navn']['stringValue'] ?? '';
        if ($memberId && $token) {
            $udtagne[] = ['id' => $memberId, 'navn' => $navn, 'token' => $token];
        }
    }
}

// Begivenhedsdata
$type        = $f['type']['stringValue']        ?? '';
$titel       = $f['titel']['stringValue']       ?? '';
$dato        = $f['dato']['stringValue']        ?? '';
$tidspunkt   = $f['tidspunkt']['stringValue']   ?? '';
$modetid     = $f['modetid']['stringValue']     ?? '';
$sted        = $f['sted']['stringValue']        ?? '';
$beskrivelse = $f['beskrivelse']['stringValue'] ?? '';

$datoDk = dato_dk($dato);

// ── Send mail ─────────────────────────────────────────────────────────────────
$sendt = 0; $fejlet = 0;

if (in_array($kanal, ['mail', 'begge'], true)) {
    foreach ($udtagne as $deltager) {
        $memberDoc = fs_get("{$base}/members/{$deltager['id']}", $fsToken);
        $to = '';
        foreach ($memberDoc['fields']['allEmails']['arrayValue']['values'] ?? [] as $v) {
            $em = strtolower(trim($v['stringValue'] ?? ''));
            if ($em && filter_var($em, FILTER_VALIDATE_EMAIL)) { $to = $em; break; }
        }
        if (!$to) continue;

        if (is_test_mode()) {
            $to      = test_email();
            $subject = "[TEST → {$deltager['navn']}] Du er udtaget til {$titel}";
        } else {
            $subject = "Du er udtaget til {$titel} — Sejs-Svejbæk IF";
        }

        $html = byg_mail_html($deltager['navn'], $type, $titel, $datoDk, $tidspunkt, $modetid, $sted, $beskrivelse, $deltager['token']);

        if (smtp_send_html($to, $subject, $html)) { $sendt++; } else { $fejlet++; }
    }

    log_udsendelse($projectId, $fsToken, [
        'channel'      => 'email',
        'senderUid'    => $uid,
        'senderName'   => $senderNavn,
        'holdId'       => $holdId,
        'holdTitel'    => $holdTitel,
        'begivenhedId' => $begivenhedId,
        'scope'        => "begivenhed:{$begivenhedId}",
        'recipients'   => count($udtagne),
        'sendt'        => $sendt,
        'fejlet'       => $fejlet,
        'testMode'     => is_test_mode(),
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

    // Hent telefonnumre live fra Conventus: conventus_id (string) → msisdn (int)
    $phoneMap = hent_conventus_telefonmap(getenv('CONVENTUS_KEY') ?: '');

    foreach ($udtagne as $deltager) {
        $msisdn = $phoneMap[$deltager['id']] ?? null;
        if (!$msisdn) continue;

        $svarUrl = 'https://app.sejssvejbaek-if.dk/s/' . rawurlencode($deltager['token']);
        $smsText = "{$titel} {$datoDk} kl. {$tidspunkt}. Svar: {$svarUrl}";

        if (is_test_mode()) {
            $msisdn  = conventus_msisdn_til_int(test_phone());
            $smsText = "[TEST→{$deltager['navn']}] {$smsText}";
        }

        if (!$msisdn) continue;

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
        'senderUid'     => $uid,
        'senderName'    => $senderNavn,
        'holdId'        => $holdId,
        'holdTitel'     => $holdTitel,
        'begivenhedId'  => $begivenhedId,
        'scope'         => "begivenhed:{$begivenhedId}",
        'recipients'    => count($udtagne),
        'sendt'         => $smsSendt,
        'fejlet'        => $smsFejlet,
        'parts'         => $smsParts,
        'estimatedCost' => $kostDkk,
        'testMode'      => is_test_mode(),
    ]);
    $sendt  += $smsSendt;
    $fejlet += $smsFejlet;
}

// Opdatér status → 'udsendt' hvis mindst én kom frem
if ($sendt > 0) {
    $now       = date('Y-m-d\TH:i:s\Z');
    $maskParts = 'updateMask.fieldPaths=status&updateMask.fieldPaths=udsendt_at';
    @file_get_contents("{$base}/begivenheder/{$begivenhedId}?{$maskParts}", false, stream_context_create(['http' => [
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

// Hjælpefunktioner er i _send_helpers.php (loaded via require_once ovenfor)
