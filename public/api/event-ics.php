<?php
/**
 * Returnér .ics kalenderbegivenhed for et SSIF-event.
 *
 * GET ?token=<icsToken>
 * Ingen Firebase-auth krævet — token er en uforudsigelig UUID v4.
 * Kan åbnes direkte af iOS Kalender, Google Calendar, Outlook m.fl.
 */

header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') { http_response_code(405); exit; }

$token = trim($_GET['token'] ?? '');
if (!$token || !preg_match('/^[0-9a-f\-]{32,36}$/i', $token)) {
    http_response_code(400); header('Content-Type: text/plain'); echo 'Ugyldigt token'; exit;
}

// ── Firebase service account ──────────────────────────────────────────────────
$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500); header('Content-Type: text/plain'); echo 'Konfiguration mangler'; exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

$accessToken = google_access_token($sa, 'https://www.googleapis.com/auth/datastore');
if (!$accessToken) {
    http_response_code(500); header('Content-Type: text/plain'); echo 'Auth fejlede'; exit;
}

// ── Hent event fra Firestore via icsToken ────────────────────────────────────
$queryUrl = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:runQuery";
$resp = @file_get_contents($queryUrl, false, stream_context_create(['http' => [
    'method'        => 'POST',
    'header'        => "Authorization: Bearer {$accessToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode([
        'structuredQuery' => [
            'from'  => [['collectionId' => 'events']],
            'where' => [
                'fieldFilter' => [
                    'field' => ['fieldPath' => 'icsToken'],
                    'op'    => 'EQUAL',
                    'value' => ['stringValue' => $token],
                ],
            ],
            'limit' => 1,
        ],
    ]),
    'timeout'       => 15,
    'ignore_errors' => true,
]]));

$fields = null;
foreach (json_decode($resp ?: '[]', true) as $row) {
    if (isset($row['document']['fields'])) { $fields = $row['document']['fields']; break; }
}

if (!$fields) {
    http_response_code(404); header('Content-Type: text/plain'); echo 'Event ikke fundet'; exit;
}

function fs($fields, string $key): string {
    return $fields[$key]['stringValue'] ?? '';
}

$titel       = fs($fields, 'titel');
$dato        = fs($fields, 'dato');
$tidStart    = fs($fields, 'tidStart');
$tidSlut     = fs($fields, 'tidSlut');
$sted        = fs($fields, 'sted');
$beskrivelse = fs($fields, 'beskrivelse');
$holdNavn    = fs($fields, 'holdNavn');
$type        = fs($fields, 'type');

// ── Byg ICS timestamps (lokal tid, ingen Z = flydende/lokal) ─────────────────
function ics_dt(string $date, string $time): string {
    if (!$date || !$time) return '';
    [$y, $m, $d] = explode('-', $date);
    [$h, $min]   = explode(':', $time);
    return sprintf('%04d%02d%02dT%02d%02d00', (int)$y, (int)$m, (int)$d, (int)$h, (int)$min);
}

$dtStart = ics_dt($dato, $tidStart);
if (!$dtStart) {
    http_response_code(422); header('Content-Type: text/plain'); echo 'Event mangler dato/tid'; exit;
}

if ($tidSlut) {
    $dtEnd = ics_dt($dato, $tidSlut);
} else {
    $dtEnd = date('Ymd\THis', strtotime("{$dato} {$tidStart}") + 3600);
}

function ics_esc(string $s): string {
    return str_replace(["\r\n", "\n", "\r", ',', ';', '\\'], ['\n', '\n', '\n', '\,', '\;', '\\\\'], trim($s));
}

$summary  = ics_esc($titel . ($holdNavn ? " — {$holdNavn}" : ''));
$location = ics_esc($sted);
$desc     = ics_esc($beskrivelse ?: ($type === 'kamp' ? 'Kamp/udtagelse — Sejs-Svejbæk IF' : 'Event — Sejs-Svejbæk IF'));
$uid      = $token . '@sejssvejbaek-if.dk';
$now      = gmdate('Ymd\THis\Z');

$ics = "BEGIN:VCALENDAR\r\n"
     . "VERSION:2.0\r\n"
     . "PRODID:-//Sejs-Svejbaek IF//SSIF App//DA\r\n"
     . "CALSCALE:GREGORIAN\r\n"
     . "METHOD:PUBLISH\r\n"
     . "BEGIN:VEVENT\r\n"
     . "UID:{$uid}\r\n"
     . "DTSTAMP:{$now}\r\n"
     . "DTSTART:{$dtStart}\r\n"
     . "DTEND:{$dtEnd}\r\n"
     . "SUMMARY:{$summary}\r\n"
     . ($location ? "LOCATION:{$location}\r\n" : '')
     . "DESCRIPTION:{$desc}\r\n"
     . "ORGANIZER;CN=SSIF App:mailto:noreply@sejssvejbaek-if.dk\r\n"
     . "END:VEVENT\r\n"
     . "END:VCALENDAR\r\n";

$filename = preg_replace('/[^a-z0-9\-]/i', '-', $titel ?: 'event') . '.ics';
header('Content-Type: text/calendar; charset=utf-8');
header("Content-Disposition: attachment; filename=\"{$filename}\"");
echo $ics;

// ── Google OAuth 2.0 via service account ──────────────────────────────────────
function google_access_token(array $sa, string $scope): string {
    $now = time();
    $h   = rtrim(strtr(base64_encode(json_encode(['alg'=>'RS256','typ'=>'JWT'])),'+/','-_'),'=');
    $p   = rtrim(strtr(base64_encode(json_encode([
        'iss' => $sa['client_email'], 'scope' => $scope,
        'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600,
    ])),'+/','-_'),'=');
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . rtrim(strtr(base64_encode($sig),'+/','-_'),'=');
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content' => http_build_query(['grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion'=>$jwt]),
        'timeout' => 10, 'ignore_errors' => true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}
