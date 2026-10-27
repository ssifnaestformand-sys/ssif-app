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

// ── Hjælpere ──────────────────────────────────────────────────────────────────

function dato_dk(string $dato): string {
    if (!$dato) return '';
    $parts  = explode('-', $dato);
    $months = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
    $dows   = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];
    $ts     = mktime(12, 0, 0, (int)($parts[1] ?? 1), (int)($parts[2] ?? 1), (int)($parts[0] ?? 2000));
    return $dows[(int)date('w', $ts)] . ' d. ' . (int)($parts[2] ?? 0) . '. ' . ($months[(int)($parts[1] ?? 1) - 1] ?? '');
}

function t_row(string $label, string $value): string {
    return "<tr>"
         . "<td style=\"padding:9px 14px;font-size:12px;font-weight:700;color:#888;width:30%;border-bottom:1px solid #dde5dd\">{$label}</td>"
         . "<td style=\"padding:9px 14px;font-size:14px;font-weight:600;color:#1a1a1a;border-bottom:1px solid #dde5dd\">{$value}</td>"
         . "</tr>";
}

function byg_mail_html(string $navn, string $type, string $titel, string $dato, string $tid, string $modetid, string $sted, string $beskrivelse, string $token): string {
    $svarBase  = 'https://app.sejssvejbaek-if.dk/s/' . rawurlencode($token);
    $kommerUrl = $svarBase . '?svar=kommer';
    $ikkeUrl   = $svarBase . '?svar=kommer_ikke';

    $typeLabel = ['kamp' => 'Kamp', 'stævne' => 'Stævne', 'event' => 'Event', 'møde' => 'Møde'][$type] ?? ucfirst($type);

    $rows = '';
    if ($dato)    $rows .= t_row('Dato',      htmlspecialchars($dato));
    if ($tid)     $rows .= t_row('Tidspunkt', htmlspecialchars($tid));
    if ($modetid) $rows .= t_row('Mødetid',   htmlspecialchars($modetid));
    if ($sted)    $rows .= t_row('Sted',       htmlspecialchars($sted));

    $navnEnc   = htmlspecialchars($navn);
    $titEnc    = htmlspecialchars($titel);
    $besk      = $beskrivelse
        ? '<p style="margin:16px 0 0;font-size:14px;color:#555;line-height:1.6">'
          . nl2br(htmlspecialchars($beskrivelse)) . '</p>'
        : '';

    return <<<HTML
<!DOCTYPE html>
<html lang="da">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f4;font-family:system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table width="100%" style="max-width:480px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.08)">
  <tr><td style="background:#1a5c2a;padding:18px 24px">
    <p style="margin:0;color:#fff;font-size:18px;font-weight:800">&#9917; SSIF Tr&aelig;ner</p>
  </td></tr>
  <tr><td style="padding:24px">
    <p style="margin:0 0 6px;font-size:14px;color:#4a4a4a">Hej {$navnEnc},</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:800;color:#1a1a1a">Du er udtaget til {$typeLabel}</h1>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dde5dd;border-radius:10px;overflow:hidden;margin-bottom:20px">
      {$rows}
    </table>
    {$besk}
    <p style="margin:24px 0 12px;font-size:14px;font-weight:700;color:#1a1a1a;text-align:center">Kan du komme?</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="48%" align="center">
        <a href="{$kommerUrl}" style="display:block;background:#1a5c2a;color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 0;border-radius:11px;text-align:center">Kommer &#10003;</a>
      </td>
      <td width="4%"></td>
      <td width="48%" align="center">
        <a href="{$ikkeUrl}" style="display:block;background:#fff;color:#dc2626;text-decoration:none;font-size:15px;font-weight:700;padding:12px 0;border-radius:11px;text-align:center;border:1.5px solid #fecaca">Kommer ikke</a>
      </td>
    </tr></table>
    <p style="margin:20px 0 0;font-size:12px;color:#888;text-align:center">Venlig hilsen &middot; Sejs-Svejb&aelig;k IF</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>
HTML;
}

function smtp_send_html(string $to, string $subject, string $html): bool {
    $host = 'send.one.com';
    $port = 465;
    $user = 'noreply@sejssvejbaek-if.dk';
    $pass = getenv('SMTP_PASSWORD') ?: '';
    $from = 'noreply@sejssvejbaek-if.dk';
    if (!$pass) return false;
    $ctx  = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $sock = @stream_socket_client("ssl://{$host}:{$port}", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$sock) return false;
    stream_set_timeout($sock, 10);
    smtp_r($sock);
    smtp_c($sock, 'EHLO sejssvejbaek-if.dk');
    smtp_c($sock, 'AUTH LOGIN');
    smtp_c($sock, base64_encode($user));
    $r = smtp_c($sock, base64_encode($pass));
    if (strncmp($r, '235', 3) !== 0) { fclose($sock); return false; }
    smtp_c($sock, "MAIL FROM:<{$from}>");
    smtp_c($sock, "RCPT TO:<{$to}>");
    smtp_c($sock, 'DATA');
    $enc = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $msg = "Date: " . date('r') . "\r\n"
         . "From: SSIF =?UTF-8?B?" . base64_encode('Træner') . "?= <{$from}>\r\n"
         . "To: {$to}\r\nSubject: {$enc}\r\n"
         . "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
         . $html . "\r\n.";
    smtp_c($sock, $msg);
    fwrite($sock, "QUIT\r\n");
    fclose($sock);
    return true;
}

function smtp_r($s): string { $o = ''; while ($l = fgets($s, 512)) { $o = $l; if (isset($l[3]) && $l[3] === ' ') break; } return $o; }
function smtp_c($s, string $c): string { fwrite($s, $c . "\r\n"); return smtp_r($s); }

// Henter alle Conventus-membres og returnerer map: conventus_id (string) → msisdn (int)
// Telefonnumre gemmes ALDRIG — bruges kun i denne request.
function hent_conventus_telefonmap(string $apiKey): array {
    if (!$apiKey) return [];
    $ctx = stream_context_create(['http' => ['timeout' => 90, 'ignore_errors' => true]]);
    $url = 'https://www.conventus.dk/dataudv/api/adressebog/get_medlemmer.php?' . http_build_query([
        'forening'   => '1031',
        'key'        => $apiKey,
        'relationer' => 'true',
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if (!$raw) return [];
    if (preg_match('/encoding=["\']ISO-8859-1["\']/i', $raw)) {
        $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
        $raw = preg_replace('/encoding=["\']ISO-8859-1["\']/i', 'encoding="UTF-8"', $raw);
    }
    if (strpos(ltrim($raw), '<') !== 0) return [];

    libxml_use_internal_errors(true);
    $reader = new XMLReader();
    if (!$reader->XML($raw, 'UTF-8', LIBXML_NOERROR | LIBXML_NOWARNING)) return [];

    $map = [];
    while ($reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT) continue;
        if (strtolower($reader->localName) !== 'medlem') continue;
        if ($reader->depth !== 2) continue;
        $xml = $reader->readOuterXml();
        $reader->next();
        if (!$xml) continue;
        $k = @simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NOERROR | LIBXML_NOWARNING);
        if (!$k) continue;
        if (strtolower(trim((string)($k->slettet ?? ''))) === 'true') { unset($k); continue; }

        $id        = trim((string)($k->id ?? ''));
        $mobil     = trim((string)($k->mobil ?? ''));
        $mobilCode = trim((string)($k->mobil_dialCode ?? '45')) ?: '45';
        $tlf       = trim((string)($k->tlf ?? ''));
        $tlfCode   = trim((string)($k->tlf_dialCode ?? '45')) ?: '45';

        if ($mobil && strtolower(trim((string)($k->off_mobil ?? 'true'))) === 'false') { unset($k); continue; }

        $msisdn = $mobil ? conventus_msisdn_til_int('+' . preg_replace('/\D/', '', $mobilCode . preg_replace('/\D/', '', $mobil))) : null;
        if (!$msisdn && $tlf) $msisdn = conventus_msisdn_til_int('+' . preg_replace('/\D/', '', $tlfCode . preg_replace('/\D/', '', $tlf)));

        if ($id && $msisdn) $map[$id] = $msisdn;
        unset($k);
    }
    $reader->close();
    libxml_clear_errors();
    return $map;
}

function conventus_msisdn_til_int(string $e164): ?int {
    $digits = preg_replace('/\D/', '', $e164);
    if (!$digits) return null;
    $v = (int)$digits;
    $len = strlen((string)$v);
    return ($len >= 7 && $len <= 15) ? $v : null;
}

function sms_parts_bev(string $text): int {
    if (!$text) return 1;
    $gsm7 = '@£$¥èéùìòÇ' . "\n" . 'Øø' . "\r" . 'ÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜäöñüàÅ§¿abcdefghijklmnopqrstuvwxyz' . "\t\x0b\x0c" . '{}\\[~]|^€';
    $ucs2 = false;
    foreach (preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY) as $c) {
        if (mb_strpos($gsm7, $c, 0, 'UTF-8') === false) { $ucs2 = true; break; }
    }
    $len = mb_strlen($text);
    if ($ucs2) return $len <= 70 ? 1 : (int)ceil($len / 67);
    return $len <= 160 ? 1 : (int)ceil($len / 153);
}

function log_udsendelse(string $projectId, string $fsToken, array $data): void {
    $now    = date('Y-m-d\TH:i:s\Z');
    $fields = [
        'sentAt'       => ['timestampValue' => $now],
        'channel'      => ['stringValue'    => $data['channel']],
        'senderUid'    => ['stringValue'    => $data['senderUid']],
        'senderName'   => ['stringValue'    => $data['senderName']],
        'holdId'       => ['stringValue'    => $data['holdId']],
        'holdTitel'    => ['stringValue'    => $data['holdTitel']],
        'begivenhedId' => ['stringValue'    => $data['begivenhedId']],
        'scope'        => ['stringValue'    => $data['scope']],
        'recipients'   => ['integerValue'   => (string)$data['recipients']],
        'sendt'        => ['integerValue'   => (string)$data['sendt']],
        'fejlet'       => ['integerValue'   => (string)$data['fejlet']],
        'testMode'     => ['booleanValue'   => (bool)$data['testMode']],
        'ok'           => ['booleanValue'   => $data['sendt'] > 0],
    ];
    $url = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/kommunikation_logs";
    @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => $fields]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
}
