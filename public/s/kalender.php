<?php
/**
 * Generér ICS-fil for en begivenhed via svar-token.
 *
 * GET /s/kalender.php?token=<svar-token>
 *
 * Kræver ikke Firebase-login — adgang er begrænset til indehavere af
 * det hemmelige svar-token (32 tilfældige hex-tegn).
 * Returnerer kun offentlig begivenhedsdata (ingen personoplysninger).
 */

$saPath = __DIR__ . '/../api/firebase-service-account.json';
if (!file_exists($saPath)) { http_response_code(503); exit; }
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];
$fsBase    = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents";

$token = trim($_GET['token'] ?? '');
if (!$token || !preg_match('/^[0-9a-f]{32}$/', $token)) { http_response_code(404); exit; }

$fsToken = kal_sa_token($sa);
if (!$fsToken) { http_response_code(503); exit; }

$link = kal_fs_get("{$fsBase}/svarlinks/{$token}", $fsToken);
if (!$link) { http_response_code(404); exit; }
$begivenhedId = $link['fields']['begivenhedId']['stringValue'] ?? '';
if (!$begivenhedId) { http_response_code(404); exit; }

$bev = kal_fs_get("{$fsBase}/begivenheder/{$begivenhedId}", $fsToken);
if (!$bev) { http_response_code(404); exit; }
$bf = $bev['fields'];

$type        = $bf['type']['stringValue']        ?? '';
$titel       = $bf['titel']['stringValue']       ?? 'Begivenhed';
$dato        = $bf['dato']['stringValue']        ?? '';
$tidspunkt   = $bf['tidspunkt']['stringValue']   ?? '';
$modetid     = $bf['modetid']['stringValue']     ?? '';
$sted        = $bf['sted']['stringValue']        ?? '';
$beskrivelse = $bf['beskrivelse']['stringValue'] ?? '';

if (!$dato) { http_response_code(404); exit; }

$typeLabel = ['kamp'=>'Kamp','stævne'=>'Stævne','event'=>'Event','møde'=>'Møde'][$type] ?? ucfirst($type);
$summary   = $typeLabel . ': ' . $titel;

// ── Byg DTSTART / DTEND ──────────────────────────────────────────────────────
$tz = new DateTimeZone('Europe/Copenhagen');

if ($tidspunkt && preg_match('/^(\d{1,2}):(\d{2})$/', $tidspunkt, $m)) {
    $start = new DateTime("{$dato} {$m[1]}:{$m[2]}:00", $tz);
    $end   = (clone $start)->modify('+2 hours');
    $dtStart = 'DTSTART;TZID=Europe/Copenhagen:' . $start->format('Ymd\THis');
    $dtEnd   = 'DTEND;TZID=Europe/Copenhagen:'   . $end->format('Ymd\THis');
} else {
    [$y, $mo, $d] = array_map('intval', explode('-', $dato));
    $allDay  = sprintf('%04d%02d%02d', $y, $mo, $d);
    $endDay  = (new DateTime($dato, $tz))->modify('+1 day')->format('Ymd');
    $dtStart = 'DTSTART;VALUE=DATE:' . $allDay;
    $dtEnd   = 'DTEND;VALUE=DATE:'   . $endDay;
}

// ── Beskrivelse (mødetid øverst hvis sat) ────────────────────────────────────
$descParts = [];
if ($modetid) $descParts[] = "Mødetid: {$modetid}";
if ($beskrivelse) $descParts[] = $beskrivelse;
$desc = implode('\n\n', $descParts);

// ── ICS-escape ────────────────────────────────────────────────────────────────
function ics_escape(string $v): string {
    return str_replace(['\\', ';', ',', "\r\n", "\r", "\n"],
                       ['\\\\', '\\;', '\\,', '\\n', '\\n', '\\n'], $v);
}

// ── RFC 5545 linjefoldning (max 75 oktetter, fold med CRLF + mellemrum) ──────
function ics_fold(string $line): string {
    $out = '';
    while (mb_strlen($line, '8bit') > 75) {
        // Find sikker kløveposition (undgå midt i multibyte-sekvens)
        $cut = 75;
        while ($cut > 1 && (ord($line[$cut]) & 0xC0) === 0x80) $cut--;
        $out  .= substr($line, 0, $cut) . "\r\n ";
        $line  = substr($line, $cut);
    }
    return $out . $line . "\r\n";
}

$uid  = 'ssif-' . $begivenhedId . '@sejssvejbaek-if.dk';
$now  = gmdate('Ymd\THis\Z');
$name = 'ssif-' . preg_replace('/[^a-z0-9]+/', '-', strtolower($titel)) . '.ics';

$lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sejs-Svejbæk IF//SSIF Træner//DA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:'         . $uid,
    $dtStart,
    $dtEnd,
    'DTSTAMP:'     . $now,
    'SUMMARY:'     . ics_escape($summary),
    'LOCATION:'    . ics_escape($sted),
    'DESCRIPTION:' . ics_escape($desc),
    'END:VEVENT',
    'END:VCALENDAR',
];

header('Content-Type: text/calendar; charset=UTF-8');
header('Content-Disposition: attachment; filename="' . $name . '"');
header('Cache-Control: no-cache, no-store, must-revalidate');

foreach ($lines as $line) {
    echo ics_fold($line);
}

// ── Hjælpere ──────────────────────────────────────────────────────────────────

function kal_sa_token(array $sa): string {
    $now = time();
    $h   = rtrim(strtr(base64_encode(json_encode(['alg' => 'RS256', 'typ' => 'JWT'])), '+/', '-_'), '=');
    $p   = rtrim(strtr(base64_encode(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/datastore',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ])), '+/', '-_'), '=');
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . rtrim(strtr(base64_encode($sig), '+/', '-_'), '=');
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content'       => http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}

function kal_fs_get(string $url, string $token): ?array {
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'GET',
        'header'        => "Authorization: Bearer {$token}\r\n",
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    if (!$resp) return null;
    $data = json_decode($resp, true);
    return isset($data['fields']) ? $data : null;
}
