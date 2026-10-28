<?php
/**
 * Send simpel besked til alle aktive holdmedlemmer – ingen tilmelding.
 *
 * POST  Authorization: Bearer <token>
 *       { holdId: "123", kanal: "mail"|"sms"|"begge", emne: "...", besked: "..." }
 *
 * Emne bruges kun som mail-subject (ignoreres ved ren SMS).
 * Returnerer: { ok: true, sendt: N, fejlet: M }
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
ignore_user_abort(true);

// ── Auth ──────────────────────────────────────────────────────────────────────
$auth         = trainer_auth();
$uid          = $auth['uid'];
$email        = $auth['email'];
$conventus_id = $auth['conventus_id'];
$fsToken      = $auth['fsToken'];
$projectId    = $auth['projectId'];
$base         = $auth['base'];

// ── Input ─────────────────────────────────────────────────────────────────────
$body        = json_decode(file_get_contents('php://input'), true) ?? [];
$holdId      = trim((string)($body['holdId'] ?? ''));
$kanal       = trim((string)($body['kanal']  ?? 'mail'));
$emne        = trim((string)($body['emne']   ?? ''));
$besked      = trim((string)($body['besked'] ?? ''));
$extraEmails = array_values(array_filter(array_map('trim', (array)($body['extraEmails'] ?? [])),
    fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)));
$extraPhones = array_values(array_filter(array_map(fn($p) => parse_extra_phone(trim($p)), (array)($body['extraPhones'] ?? []))));

if (!$holdId) { http_response_code(400); echo json_encode(['error' => 'holdId mangler']); exit; }
if (!$besked) { http_response_code(400); echo json_encode(['error' => 'Besked mangler']); exit; }
if (!in_array($kanal, ['mail', 'sms'], true)) {
    http_response_code(400); echo json_encode(['error' => 'Ugyldig kanal (mail eller sms)']); exit;
}

// ── Adgangscheck ──────────────────────────────────────────────────────────────
$lederHolds = get_leder_holds($email, $conventus_id, $projectId, $fsToken);
if (!isset($lederHolds[$holdId])) {
    http_response_code(403); echo json_encode(['error' => 'Ingen adgang til dette hold']); exit;
}

// ── Kontekst ──────────────────────────────────────────────────────────────────
$holdDoc   = fs_get("{$base}/holds/{$holdId}", $fsToken);
$holdTitel = $holdDoc ? ($holdDoc['fields']['titel']['stringValue'] ?? "Hold {$holdId}") : "Hold {$holdId}";

$senderNavn = '';
if ($conventus_id) {
    $m = fs_get("{$base}/members/{$conventus_id}", $fsToken);
    $senderNavn = $m ? ($m['fields']['name']['stringValue'] ?? '') : '';
}

$tc = trainer_app_config($base, $fsToken);
if ($tc['testMode']) {
    if (in_array($kanal, ['mail', 'begge'], true) && $tc['testEmail'] === '') {
        http_response_code(500);
        echo json_encode(['error' => 'Testtilstand aktiv men testmail mangler i backoffice']);
        exit;
    }
    if (in_array($kanal, ['sms', 'begge'], true) && $tc['testPhone'] === '') {
        http_response_code(500);
        echo json_encode(['error' => 'Testtilstand aktiv men testtelefon mangler i backoffice']);
        exit;
    }
}

// ── Holdmedlemmer fra Firestore ───────────────────────────────────────────────
// Samme forespørgsel som hold-spillere.php — stringValue + integerValue fallback.
$seen    = [];
$members = [];
foreach ([['stringValue' => $holdId], ctype_digit($holdId) ? ['integerValue' => (int)$holdId] : null] as $filter) {
    if (!$filter) continue;
    $rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
        'from'  => [['collectionId' => 'members']],
        'where' => ['fieldFilter' => [
            'field' => ['fieldPath' => 'holdIds'],
            'op'    => 'ARRAY_CONTAINS',
            'value' => $filter,
        ]],
    ]]);
    foreach ($rows as $row) {
        if (!isset($row['document']['fields'])) continue;
        $id = basename($row['document']['name'] ?? '');
        if ($id && !isset($seen[$id])) {
            $seen[$id] = true;
            $members[] = ['id' => $id, 'fields' => $row['document']['fields']];
        }
    }
}

$sendt = 0; $fejlet = 0;

// ── Send mail ─────────────────────────────────────────────────────────────────
if ($kanal === 'mail') {
    $subjectBase = $emne ?: "Besked fra {$senderNavn} — {$holdTitel}";

    foreach ($members as $m) {
        $to   = '';
        $navn = $m['fields']['name']['stringValue'] ?? '';
        foreach ($m['fields']['allEmails']['arrayValue']['values'] ?? [] as $v) {
            $em = strtolower(trim($v['stringValue'] ?? ''));
            if ($em && filter_var($em, FILTER_VALIDATE_EMAIL)) { $to = $em; break; }
        }
        if (!$to) { $fejlet++; continue; }
        $subj = $tc['testMode'] ? "[TEST → {$navn}] {$subjectBase}" : $subjectBase;
        $to   = $tc['testMode'] ? $tc['testEmail'] : $to;
        if (smtp_send_html($to, $subj, byg_besked_html($navn, $senderNavn, $holdTitel, $besked))) $sendt++; else $fejlet++;
    }
    // Ekstra e-mail-adresser (manuelt tilføjet)
    foreach ($extraEmails as $to) {
        $subj = $tc['testMode'] ? "[TEST] {$subjectBase}" : $subjectBase;
        $to   = $tc['testMode'] ? $tc['testEmail'] : $to;
        if (smtp_send_html($to, $subj, byg_besked_html('', $senderNavn, $holdTitel, $besked))) $sendt++; else $fejlet++;
    }

    log_udsendelse($projectId, $fsToken, [
        'channel' => 'email', 'senderUid' => $uid, 'senderName' => $senderNavn,
        'holdId' => $holdId, 'holdTitel' => $holdTitel, 'begivenhedId' => '',
        'scope' => 'besked', 'recipients' => count($members) + count($extraEmails),
        'sendt' => $sendt, 'fejlet' => $fejlet, 'testMode' => $tc['testMode'],
    ]);
}

// ── Send SMS ──────────────────────────────────────────────────────────────────
$smsSendt = 0; $smsFejlet = 0;
if ($kanal === 'sms') {
    $smsKey = getenv('SMS_API_KEY') ?: '';
    if (!$smsKey) { http_response_code(503); echo json_encode(['error' => 'SMS_API_KEY mangler']); exit; }

    $phoneMap = hent_conventus_telefonmap(getenv('CONVENTUS_KEY') ?: '');
    $smsParts = sms_parts_bev($besked);

    // Hold-medlemmer via Conventus-telefonmappen
    foreach ($members as $m) {
        $msisdn   = $phoneMap[$m['id']] ?? null;
        if (!$msisdn) continue;
        $sendText = $besked;
        if ($tc['testMode']) {
            $msisdn   = conventus_msisdn_til_int($tc['testPhone']);
            $sendText = "[TEST→{$m['fields']['name']['stringValue']}] {$besked}";
        }
        if (!$msisdn) continue;
        $gw = @file_get_contents('https://gatewayapi.com/rest/mtsms', false, stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Authorization: Token {$smsKey}\r\nContent-Type: application/json\r\n",
            'content' => json_encode(['sender' => sms_afsender($holdTitel), 'message' => $sendText, 'recipients' => [['msisdn' => $msisdn]]]),
            'timeout' => 10, 'ignore_errors' => true,
        ]]));
        $gd = json_decode($gw ?: '{}', true);
        if (isset($gd['ids']) && !isset($gd['code'])) $smsSendt++; else $smsFejlet++;
    }
    // Ekstra numre (manuelt tilføjet — aldrig gemt)
    foreach ($extraPhones as $msisdn) {
        $sendText = $besked;
        if ($tc['testMode']) { $msisdn = conventus_msisdn_til_int($tc['testPhone']); $sendText = "[TEST] {$besked}"; }
        if (!$msisdn) continue;
        $gw = @file_get_contents('https://gatewayapi.com/rest/mtsms', false, stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Authorization: Token {$smsKey}\r\nContent-Type: application/json\r\n",
            'content' => json_encode(['sender' => sms_afsender($holdTitel), 'message' => $sendText, 'recipients' => [['msisdn' => $msisdn]]]),
            'timeout' => 10, 'ignore_errors' => true,
        ]]));
        $gd = json_decode($gw ?: '{}', true);
        if (isset($gd['ids']) && !isset($gd['code'])) $smsSendt++; else $smsFejlet++;
    }

    log_udsendelse($projectId, $fsToken, [
        'channel' => 'sms', 'senderUid' => $uid, 'senderName' => $senderNavn,
        'holdId' => $holdId, 'holdTitel' => $holdTitel, 'begivenhedId' => '',
        'scope' => 'besked', 'recipients' => count($members) + count($extraPhones),
        'sendt' => $smsSendt, 'fejlet' => $smsFejlet,
        'parts' => $smsParts, 'estimatedCost' => round($smsSendt * $smsParts * 0.29, 2),
        'testMode' => $tc['testMode'],
    ]);
    $sendt  += $smsSendt;
    $fejlet += $smsFejlet;
}

echo json_encode(['ok' => true, 'sendt' => $sendt, 'fejlet' => $fejlet]);

// ── Hjælpere ──────────────────────────────────────────────────────────────────

function parse_extra_phone(string $raw): ?int {
    $clean = preg_replace('/[\s\-\(\)]/', '', $raw);
    if (preg_match('/^\+\d{8,15}$/', $clean))  return conventus_msisdn_til_int($clean);
    if (preg_match('/^00\d{8,13}$/', $clean))   return conventus_msisdn_til_int('+' . substr($clean, 2));
    if (preg_match('/^\d{8}$/', $clean))        return conventus_msisdn_til_int('+45' . $clean);
    return null;
}

// ── Mail-template ─────────────────────────────────────────────────────────────
function byg_besked_html(string $modtagerNavn, string $afsenderNavn, string $holdNavn, string $besked): string {
    $navnEnc = htmlspecialchars($modtagerNavn);
    $afsEnc  = htmlspecialchars($afsenderNavn ?: 'Træneren');
    $holdEnc = htmlspecialchars($holdNavn);
    $besk    = nl2br(htmlspecialchars($besked));
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
    <p style="margin:0 0 4px;font-size:14px;color:#4a4a4a">Hej {$navnEnc},</p>
    <p style="margin:0 0 18px;font-size:14px;color:#4a4a4a">{$afsEnc} har sendt en besked til {$holdEnc}:</p>
    <div style="background:#f4f6f4;border-left:3px solid #1a5c2a;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px;font-size:14px;color:#1a1a1a;line-height:1.65">
      {$besk}
    </div>
    <p style="margin:0;font-size:12px;color:#888;text-align:center">Venlig hilsen &middot; Sejs-Svejb&aelig;k IF</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>
HTML;
}
