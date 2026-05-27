<?php
/**
 * Send push- og email-notifikationer når et event oprettes.
 *
 * POST { eventId: string }
 * Kræver trainer eller admin.
 *
 * Generel event → notificerer alle medlemmer på holdet (bypass opt-in).
 * Kamp/udtagelse → notificerer kun udtagne spillere (udtagneSpillere[].email).
 *
 * Push sendes via FCM HTTP v1 til brugere med fcmToken i Firestore.
 * Email sendes via SMTP til relevante Conventus-emails.
 */

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();
set_time_limit(120);

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

// ── Auth ──────────────────────────────────────────────────────────────────────
$bearerToken = bearer_token();
if (!$bearerToken) { http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit; }

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) { http_response_code(500); echo json_encode(['error' => 'Service account mangler']); exit; }
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

if (!verify_firebase_id_token($bearerToken, $projectId)) {
    http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit;
}
$callerUid = uid_from_token($bearerToken);

// Tokens: datastore til Firestore-læsning, messaging til FCM
$fsToken  = get_sa_token($sa, 'https://www.googleapis.com/auth/datastore');
$fcmToken = get_sa_token($sa, 'https://www.googleapis.com/auth/firebase.messaging');
if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'OAuth fejlede']); exit; }

require_role($callerUid, $projectId, $fsToken, ['admin', 'trainer']);

// ── Input ─────────────────────────────────────────────────────────────────────
$input   = json_decode(file_get_contents('php://input'), true) ?: [];
$eventId = trim($input['eventId'] ?? '');
if (!$eventId) { http_response_code(400); echo json_encode(['error' => 'eventId påkrævet']); exit; }

// ── Hent event fra Firestore ──────────────────────────────────────────────────
$apiBase = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)";
$evResp  = @file_get_contents("{$apiBase}/documents/events/{$eventId}", false, stream_context_create(['http' => [
    'header'        => "Authorization: Bearer {$fsToken}\r\n",
    'timeout'       => 15,
    'ignore_errors' => true,
]]));
$evData = json_decode($evResp ?: '', true);
if (!isset($evData['fields'])) {
    http_response_code(404); echo json_encode(['error' => 'Event ikke fundet']); exit;
}
$f = $evData['fields'];

function fs_str(array $fields, string $key): string { return $fields[$key]['stringValue'] ?? ''; }

$type         = fs_str($f, 'type');
$titel        = fs_str($f, 'titel');
$dato         = fs_str($f, 'dato');
$tidStart     = fs_str($f, 'tidStart');
$sted         = fs_str($f, 'sted');
$holdId       = fs_str($f, 'holdId');
$holdNavn     = fs_str($f, 'holdNavn');
$oprettetAfNavn = fs_str($f, 'oprettetAfNavn');

$udtagneSpillere = [];
foreach ($f['udtagneSpillere']['arrayValue']['values'] ?? [] as $v) {
    $spFields = $v['mapValue']['fields'] ?? [];
    $email    = $spFields['email']['stringValue'] ?? '';
    $name     = $spFields['name']['stringValue'] ?? '';
    if ($email) $udtagneSpillere[] = ['email' => strtolower($email), 'name' => $name];
}

$dateLabel = '';
if ($dato) {
    $parts = explode('-', $dato);
    $months = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
    $dateLabel = (int)($parts[2] ?? 0) . '. ' . ($months[(int)($parts[1] ?? 1) - 1] ?? '');
}
$timeLabel = $tidStart ? " kl. {$tidStart}" : '';
$stedLabel = $sted ? " på {$sted}" : '';

// ── Byg notifikationsindhold ──────────────────────────────────────────────────
if ($type === 'kamp') {
    $pushTitle = "Du er udtaget! ⚽";
    $pushBody  = "{$titel} — {$dateLabel}{$timeLabel}{$stedLabel}";
    $emailSubj = "Du er udtaget til {$titel} — Sejs-Svejbæk IF";
    $emailBody = "Hej,\n\n"
               . "Du er udtaget til {$titel} ({$holdNavn}).\n\n"
               . ($dateLabel ? "Dato: {$dateLabel}\n" : '')
               . ($tidStart  ? "Tid: {$tidStart}\n"   : '')
               . ($sted      ? "Sted: {$sted}\n"      : '')
               . "\nÅbn SSIF-appen for at se detaljer og tilføje eventen til din kalender.\n\n"
               . "Venlig hilsen\nSejs-Svejbæk IF";
} else {
    $typeLabel = 'event';
    $pushTitle = "Nyt event: {$titel}";
    $pushBody  = "{$holdNavn} — {$dateLabel}{$timeLabel}{$stedLabel}";
    $emailSubj = "Nyt event: {$titel} — Sejs-Svejbæk IF";
    $emailBody = "Hej,\n\n"
               . "{$oprettetAfNavn} har oprettet et event for {$holdNavn}:\n\n"
               . "📅 {$titel}\n"
               . ($dateLabel ? "Dato: {$dateLabel}\n" : '')
               . ($tidStart  ? "Tid: {$tidStart}\n"   : '')
               . ($sted      ? "Sted: {$sted}\n"      : '')
               . "\nÅbn SSIF-appen for at se detaljer og tilføje eventen til din kalender.\n\n"
               . "Venlig hilsen\nSejs-Svejbæk IF";
}

// ── Saml emails ───────────────────────────────────────────────────────────────
$emails = [];

if ($type === 'kamp') {
    foreach ($udtagneSpillere as $sp) $emails[] = $sp['email'];
} else {
    // Alle emails fra members på dette hold (bypass emailNotifications opt-in)
    if ($holdId) {
        $mResp = @file_get_contents("{$apiBase}/documents:runQuery", false, stream_context_create(['http' => [
            'method'        => 'POST',
            'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
            'content'       => json_encode([
                'structuredQuery' => [
                    'from'  => [['collectionId' => 'members']],
                    'where' => ['fieldFilter' => [
                        'field' => ['fieldPath' => 'holdIds'],
                        'op'    => 'ARRAY_CONTAINS',
                        'value' => ['stringValue' => $holdId],
                    ]],
                    'limit' => 2000,
                ],
            ]),
            'timeout'       => 30,
            'ignore_errors' => true,
        ]]));
        foreach (json_decode($mResp ?: '[]', true) as $row) {
            foreach ($row['document']['fields']['allEmails']['arrayValue']['values'] ?? [] as $v) {
                $em = strtolower($v['stringValue'] ?? '');
                if ($em && filter_var($em, FILTER_VALIDATE_EMAIL)) $emails[] = $em;
            }
        }
    }
}

$emails = array_unique(array_filter($emails));

// ── Saml FCM-tokens fra users-samlingen ───────────────────────────────────────
$fcmTokensList = [];
if ($holdId) {
    $uResp = @file_get_contents("{$apiBase}/documents:runQuery", false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode([
            'structuredQuery' => [
                'from'  => [['collectionId' => 'users']],
                'where' => ['fieldFilter' => [
                    'field' => ['fieldPath' => 'holdIds'],
                    'op'    => 'ARRAY_CONTAINS',
                    'value' => ['stringValue' => $holdId],
                ]],
                'limit' => 1000,
            ],
        ]),
        'timeout'       => 20,
        'ignore_errors' => true,
    ]]));
    foreach (json_decode($uResp ?: '[]', true) as $row) {
        $uf  = $row['document']['fields'] ?? [];
        $tok = $uf['fcmToken']['stringValue'] ?? '';
        if (!$tok) continue;

        // For kamp: kun udtagne spillere
        if ($type === 'kamp') {
            $userEmail = strtolower($uf['email']['stringValue'] ?? '');
            $inList    = false;
            foreach ($udtagneSpillere as $sp) { if ($sp['email'] === $userEmail) { $inList = true; break; } }
            if (!$inList) continue;
        }
        $fcmTokensList[] = $tok;
    }
}

// ── Send push via FCM HTTP v1 ─────────────────────────────────────────────────
$pushSent = 0; $pushFail = 0;
if ($fcmToken) {
    foreach ($fcmTokensList as $tok) {
        $pr = @file_get_contents("https://fcm.googleapis.com/v1/projects/{$projectId}/messages:send", false,
            stream_context_create(['http' => [
                'method'        => 'POST',
                'header'        => "Authorization: Bearer {$fcmToken}\r\nContent-Type: application/json\r\n",
                'content'       => json_encode(['message' => [
                    'token'        => $tok,
                    'notification' => ['title' => $pushTitle, 'body' => $pushBody],
                    'data'         => ['type' => 'event', 'eventId' => $eventId],
                ]]),
                'timeout'       => 10,
                'ignore_errors' => true,
            ]])
        );
        $pd = json_decode($pr ?: '', true);
        isset($pd['name']) ? $pushSent++ : $pushFail++;
    }
}

// ── Send emails via SMTP ──────────────────────────────────────────────────────
$emailSent = 0; $emailFail = 0;
foreach ($emails as $to) {
    if (smtp_send($to, $emailSubj, $emailBody)) $emailSent++; else $emailFail++;
}

echo json_encode([
    'ok'        => true,
    'emailSent' => $emailSent,
    'emailFail' => $emailFail,
    'pushSent'  => $pushSent,
    'pushFail'  => $pushFail,
    'type'      => $type,
], JSON_UNESCAPED_UNICODE);

// ── Helpers ───────────────────────────────────────────────────────────────────

function get_sa_token(array $sa, string $scope): string {
    $now = time();
    $h   = rtrim(strtr(base64_encode(json_encode(['alg'=>'RS256','typ'=>'JWT'])),'+/','-_'),'=');
    $p   = rtrim(strtr(base64_encode(json_encode([
        'iss'   => $sa['client_email'], 'scope' => $scope,
        'aud'   => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600,
    ])),'+/','-_'),'=');
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . rtrim(strtr(base64_encode($sig),'+/','-_'),'=');
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http'=>[
        'method'  => 'POST',
        'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content' => http_build_query(['grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion'=>$jwt]),
        'timeout' => 10, 'ignore_errors' => true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}

function smtp_send(string $to, string $subject, string $body): bool {
    $host = 'send.one.com'; $port = 465;
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
         . "From: SSIF App <{$from}>\r\nTo: {$to}\r\nSubject: {$enc}\r\n"
         . "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
         . $body . "\r\n.";
    smtp_c($sock, $msg);
    fwrite($sock, "QUIT\r\n");
    fclose($sock);
    return true;
}
function smtp_r($s): string { $o=''; while($l=fgets($s,512)){ $o=$l; if(isset($l[3])&&$l[3]===' ')break; } return $o; }
function smtp_c($s, string $c): string { fwrite($s,$c."\r\n"); return smtp_r($s); }
