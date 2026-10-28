<?php
/**
 * Delte hjælpefunktioner til mail- og SMS-udsendelse.
 * Bruges af begivenhed-send.php og send-pamindelser.php.
 */

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

function byg_mail_html(string $navn, string $type, string $titel, string $dato, string $tid, string $modetid, string $sted, string $beskrivelse, string $token, string $holdTitel = ''): string {
    $svarBase  = 'https://app.sejssvejbaek-if.dk/s/' . rawurlencode($token);
    $kommerUrl = $svarBase . '?svar=kommer';
    $ikkeUrl   = $svarBase . '?svar=kommer_ikke';

    $typeLabel = ['kamp' => 'Kamp', 'stævne' => 'Stævne', 'event' => 'Event', 'møde' => 'Møde'][$type] ?? ucfirst($type);

    $rows = '';
    if ($dato)    $rows .= t_row('Dato',      htmlspecialchars($dato));
    if ($tid)     $rows .= t_row('Tidspunkt', htmlspecialchars($tid));
    if ($modetid) $rows .= t_row('Mødetid',   htmlspecialchars($modetid));
    if ($sted)    $rows .= t_row('Sted',       htmlspecialchars($sted));

    $navnEnc    = htmlspecialchars($navn);
    $titEnc     = htmlspecialchars($titel);
    $holdEnc    = htmlspecialchars($holdTitel);
    $holdSubtitle = $holdTitel
        ? "<p style=\"margin:4px 0 0;color:rgba(255,255,255,.85);font-size:13px;font-weight:600\">{$holdEnc}</p>"
        : '';
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
    {$holdSubtitle}
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

function byg_tilkendegivelse_mail(string $navn, string $titel, array $datoer, string $besked, string $token, string $holdTitel = ''): string {
    $svarUrl  = 'https://app.sejssvejbaek-if.dk/s/' . rawurlencode($token);

    $navnEnc  = htmlspecialchars($navn);
    $titEnc   = htmlspecialchars($titel);
    $holdEnc  = htmlspecialchars($holdTitel);
    $holdSub  = $holdTitel
        ? "<p style=\"margin:4px 0 0;color:rgba(255,255,255,.85);font-size:13px;font-weight:600\">{$holdEnc}</p>"
        : '';
    $beskHtml = $besked
        ? '<p style="margin:14px 0 0;font-size:14px;color:#555;line-height:1.6">' . nl2br(htmlspecialchars($besked)) . '</p>'
        : '';

    $datoRækker = '';
    foreach ($datoer as $d) {
        $dato      = htmlspecialchars($d['dato'] ?? '');
        $tidspunkt = htmlspecialchars($d['tidspunkt'] ?? '');
        $modetid   = htmlspecialchars($d['modetid'] ?? '');
        $sted      = htmlspecialchars($d['sted'] ?? '');

        $detaljer = '';
        if ($tidspunkt) $detaljer .= " kl.&nbsp;{$tidspunkt}";
        if ($sted)      $detaljer .= " &middot; {$sted}";
        if ($modetid)   $detaljer .= "<span style=\"font-size:11px;color:#888;\"> (møde {$modetid})</span>";

        $datoRækker .= "<tr>"
            . "<td style=\"padding:9px 14px;font-size:13px;font-weight:700;color:#1a5c2a;border-bottom:1px solid #dde5dd;white-space:nowrap\">{$dato}</td>"
            . "<td style=\"padding:9px 14px;font-size:13px;color:#333;border-bottom:1px solid #dde5dd\">{$detaljer}</td>"
            . "</tr>";
    }

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
    {$holdSub}
  </td></tr>
  <tr><td style="padding:24px">
    <p style="margin:0 0 6px;font-size:14px;color:#4a4a4a">Hej {$navnEnc},</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:800;color:#1a1a1a">{$titEnc}</h1>
    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#555">Træneren vil gerne vide, hvornår du kan spille:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dde5dd;border-radius:10px;overflow:hidden;margin-bottom:16px">
      {$datoRækker}
    </table>
    {$beskHtml}
    <p style="margin:20px 0 12px;font-size:14px;font-weight:700;color:#1a1a1a;text-align:center">Svar for hver dato her:</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <a href="{$svarUrl}" style="display:inline-block;background:#1a5c2a;color:#fff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 32px;border-radius:11px">Svar her &#10003;</a>
    </td></tr></table>
    <p style="margin:20px 0 0;font-size:12px;color:#888;text-align:center">Du kan &aelig;ndre dit svar, s&aring; l&aelig;nge tilkendegivelsen er &aring;ben.</p>
    <p style="margin:8px 0 0;font-size:12px;color:#aaa;text-align:center">Venlig hilsen &middot; Sejs-Svejb&aelig;k IF</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>
HTML;
}

function byg_info_mail_html(string $navn, string $titel, string $dato, string $tidspunkt, string $modetid, string $sted, string $besked, string $holdTitel = ''): string {
    $navnEnc  = htmlspecialchars($navn);
    $titEnc   = htmlspecialchars($titel);
    $holdEnc  = htmlspecialchars($holdTitel);
    $holdSub  = $holdTitel
        ? "<p style=\"margin:4px 0 0;color:rgba(255,255,255,.85);font-size:13px;font-weight:600\">{$holdEnc}</p>"
        : '';
    $beskHtml = $besked
        ? '<p style="margin:14px 0 0;font-size:14px;color:#555;line-height:1.6">' . nl2br(htmlspecialchars($besked)) . '</p>'
        : '';

    $rows = '';
    if ($dato)     $rows .= t_row('Dato',      htmlspecialchars($dato));
    if ($tidspunkt) $rows .= t_row('Tidspunkt', htmlspecialchars($tidspunkt));
    if ($modetid)  $rows .= t_row('Mødetid',   htmlspecialchars($modetid));
    if ($sted)     $rows .= t_row('Sted',       htmlspecialchars($sted));

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
    {$holdSub}
  </td></tr>
  <tr><td style="padding:24px">
    <p style="margin:0 0 6px;font-size:14px;color:#4a4a4a">Hej {$navnEnc},</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:800;color:#1a1a1a">Du er udtaget til {$titEnc}</h1>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dde5dd;border-radius:10px;overflow:hidden;margin-bottom:16px">
      {$rows}
    </table>
    {$beskHtml}
    <p style="margin:20px 0 0;font-size:14px;font-weight:700;color:#1a5c2a;text-align:center">Vi gl&aelig;der os til at se dig! &#127942;</p>
    <p style="margin:12px 0 0;font-size:12px;color:#aaa;text-align:center">Venlig hilsen &middot; Sejs-Svejb&aelig;k IF</p>
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

// Omdanner holdnavn til gyldigt SMS-afsendernavn (GatewayAPI: maks 11 ASCII-tegn).
// æ→ae, ø→oe, å→aa, mellemrum og specialtegn fjernes.
function sms_afsender(string $holdTitel): string {
    $s = mb_strtolower($holdTitel, 'UTF-8');
    $s = str_replace(['æ','ø','å','ä','ö','ü'], ['ae','oe','aa','ae','oe','ue'], $s);
    $s = preg_replace('/[^a-z0-9]/i', '', $s);
    $s = substr($s, 0, 11);
    return $s ?: 'SSIF';
}

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
    if (isset($data['parts']))         $fields['parts']         = ['integerValue' => (string)$data['parts']];
    if (isset($data['estimatedCost'])) $fields['estimatedCost'] = ['doubleValue'  => (float)$data['estimatedCost']];
    $url = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/kommunikation_logs";
    @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => $fields]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
}
