<?php
/**
 * Admin: Send bulk email via SMTP
 *
 * Modtagere hentes fra Firebase users-samlingen (ingen Conventus-kald).
 * Bruger primær email + verificerede ekstra-emails.
 *
 * POST { action:'preview'|'send', scope:'all'|'gruppe',
 *        hold_ids?:string[], subject:string, text:string }
 * Kun admin.
 */

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

set_time_limit(120);
ignore_user_abort(true);

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
$fsToken   = get_fs_oauth($sa);
if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'OAuth fejlede']); exit; }

require_role($callerUid, $projectId, $fsToken, ['admin']);

// Afsendernavn til log
$callerName = 'Admin';
$callerDoc  = @file_get_contents(
    "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/users/{$callerUid}",
    false, stream_context_create(['http' => ['header' => "Authorization: Bearer {$fsToken}\r\n", 'timeout' => 5, 'ignore_errors' => true]])
);
if ($callerDoc) {
    $cd = json_decode($callerDoc, true);
    $callerName = $cd['fields']['displayName']['stringValue'] ?? $callerName;
}

// ── Input ──────────────────────────────────────────────────────────────────────
$input      = json_decode(file_get_contents('php://input'), true) ?: [];
$action     = trim($input['action']      ?? 'preview');
$scope      = trim($input['scope']       ?? 'all');
$scopeLabel = trim($input['scope_label'] ?? '');
$subject    = trim($input['subject']     ?? '');
$text       = trim($input['text']        ?? '');
$html       = trim($input['html']        ?? '');
$rawIds     = (array)($input['hold_ids'] ?? []);
$holdIds    = array_values(array_unique(array_filter(array_map('strval', $rawIds))));

if (!$subject)  { http_response_code(400); echo json_encode(['error' => 'Emne er tomt']);  exit; }
if (!$text)     { http_response_code(400); echo json_encode(['error' => 'Besked er tom']); exit; }
if (!in_array($action, ['preview', 'send'], true)) { http_response_code(400); echo json_encode(['error' => 'Ukendt action']); exit; }

// ── Hent emails fra Firebase ───────────────────────────────────────────────────
// VIGTIGT: tom holdIds betyder kun "alle" når scope faktisk ER 'all'.
// Ved scope='gruppe' kan tom holdIds forekomme hvis brugeren kun har valgt
// specifikke medlemmer (ingen hold markeret "alle") — det må ALDRIG udløse
// et ufiltreret opslag, ellers sendes der til samtlige brugere.
$emails = ($scope === 'gruppe' && empty($holdIds)) ? [] : get_emails_from_firebase($projectId, $fsToken, $holdIds);

// Individuelle modtagere valgt via hold-picker (email-kanalen)
$specificEmails = array_values(array_unique(array_filter(
    array_map('strtolower', (array)($input['specific_emails'] ?? [])),
    fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)
)));
if (!empty($specificEmails)) {
    $emails = array_values(array_unique(array_merge($emails, $specificEmails)));
}

if ($action === 'preview') {
    echo json_encode(['ok' => true, 'count' => count($emails)]);
    exit;
}

// ── Send ───────────────────────────────────────────────────────────────────────
$smtpPass = getenv('SMTP_PASSWORD') ?: '';
if (!$smtpPass) { http_response_code(503); echo json_encode(['error' => 'SMTP ikke konfigureret']); exit; }

if (empty($emails)) {
    echo json_encode(['ok' => true, 'sent' => 0, 'failed' => 0, 'message' => 'Ingen modtagere fundet']);
    exit;
}

$result = smtp_bulk_send($emails, $subject, $text, $html, $smtpPass);

// Log til Firestore
$logFields = [
    'sentAt'     => ['timestampValue' => gmdate('Y-m-d\TH:i:s\Z')],
    'channel'    => ['stringValue'    => 'email'],
    'senderUid'  => ['stringValue'    => $callerUid],
    'senderName' => ['stringValue'    => $callerName],
    'scope'      => ['stringValue'    => $scope . ($scopeLabel ? ":{$scopeLabel}" : '')],
    'recipients' => ['integerValue'   => (string)$result['sent']],
    'failed'     => ['integerValue'   => (string)$result['failed']],
    'subject'    => ['stringValue'    => $subject],
    'text'       => ['stringValue'    => $text],
    'ok'         => ['booleanValue'   => $result['sent'] > 0],
];
if ($html) { $logFields['html'] = ['stringValue' => $html]; }
if (!empty($result['errorSamples'])) {
    $logFields['errorSamples'] = ['arrayValue' => ['values' => array_map(
        fn($e) => ['stringValue' => $e], $result['errorSamples']
    )]];
}
@file_get_contents(
    "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/kommunikation_logs",
    false, stream_context_create(['http' => [
        'method' => 'POST', 'header' => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content' => json_encode(['fields' => $logFields]), 'timeout' => 10, 'ignore_errors' => true,
    ]])
);

echo json_encode([
    'ok' => true, 'sent' => $result['sent'], 'failed' => $result['failed'],
    'errorSamples' => $result['errorSamples'] ?? [],
]);

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Henter emails fra Firebase users-samlingen.
 * holdIds tom = alle brugere.
 * holdIds udfyldt = brugere hvor holdIds-feltet indeholder mindst ét af holdene.
 */
function get_emails_from_firebase(string $projectId, string $fsToken, array $holdIds): array {
    $apiBase = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents";
    $emails  = [];

    if (empty($holdIds)) {
        // Alle brugere — page igennem
        $pageToken = null;
        do {
            $qs   = 'pageSize=500' . ($pageToken ? '&pageToken=' . urlencode($pageToken) : '');
            $resp = @file_get_contents("{$apiBase}/users?{$qs}", false,
                stream_context_create(['http' => ['header' => "Authorization: Bearer {$fsToken}\r\n", 'timeout' => 15, 'ignore_errors' => true]]));
            if (!$resp) break;
            $data = json_decode($resp, true);
            foreach ($data['documents'] ?? [] as $doc) {
                foreach (extract_emails($doc['fields'] ?? []) as $e) $emails[$e] = true;
            }
            $pageToken = $data['nextPageToken'] ?? null;
        } while ($pageToken);
    } else {
        // Specifikt hold eller afdeling — brug array-contains-any (maks 30)
        foreach (array_chunk($holdIds, 30) as $chunk) {
            $filter = count($chunk) === 1
                ? ['fieldFilter' => ['field' => ['fieldPath' => 'holdIds'], 'op' => 'ARRAY_CONTAINS',
                                     'value' => ['stringValue' => $chunk[0]]]]
                : ['fieldFilter' => ['field' => ['fieldPath' => 'holdIds'], 'op' => 'ARRAY_CONTAINS_ANY',
                                     'value' => ['arrayValue' => ['values' => array_map(function($id) {
                                         return ['stringValue' => $id];
                                     }, $chunk)]]]];

            $query = ['structuredQuery' => ['from' => [['collectionId' => 'users']], 'where' => $filter, 'limit' => 2000]];
            $resp  = @file_get_contents("{$apiBase}:runQuery", false, stream_context_create(['http' => [
                'method'  => 'POST',
                'header'  => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
                'content' => json_encode($query), 'timeout' => 15, 'ignore_errors' => true,
            ]]));
            if (!$resp) continue;
            foreach ((array)json_decode($resp, true) as $row) {
                if (!isset($row['document']['fields'])) continue;
                foreach (extract_emails($row['document']['fields']) as $e) $emails[$e] = true;
            }
        }
    }

    return array_keys($emails);
}

function extract_emails(array $fields): array {
    $out = [];
    // Primær email
    $primary = strtolower(trim($fields['email']['stringValue'] ?? $fields['primaryEmail']['stringValue'] ?? ''));
    if ($primary && filter_var($primary, FILTER_VALIDATE_EMAIL)) $out[] = $primary;
    // Verificerede ekstra-emails
    foreach ($fields['extraEmails']['arrayValue']['values'] ?? [] as $v) {
        $ef    = $v['mapValue']['fields'] ?? [];
        $email = strtolower(trim($ef['email']['stringValue'] ?? ''));
        $ver   = $ef['verified']['booleanValue'] ?? false;
        if ($email && $ver && filter_var($email, FILTER_VALIDATE_EMAIL)) $out[] = $email;
    }
    return $out;
}

// Bulk SMTP: én forbindelse for alle emails
function smtp_bulk_send(array $recipients, string $subject, string $text, string $html, string $pass): array {
    $host = 'send.one.com'; $port = 465;
    $user = 'noreply@sejssvejbaek-if.dk';
    $ctx  = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $sock = @stream_socket_client("ssl://{$host}:{$port}", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$sock) return ['sent' => 0, 'failed' => count($recipients)];
    stream_set_timeout($sock, 15);
    smtp_r($sock); smtp_c($sock, 'EHLO sejssvejbaek-if.dk');
    smtp_c($sock, 'AUTH LOGIN'); smtp_c($sock, base64_encode($user));
    if (strncmp(smtp_c($sock, base64_encode($pass)), '235', 3) !== 0) { fclose($sock); return ['sent' => 0, 'failed' => count($recipients)]; }
    $sent = 0; $failed = 0;
    $enc      = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $htmlSafe = $html ? sanitize_email_html($html) : '';
    // Indsamler DISTINKTE SMTP-fejlsvar (ingen modtager-adresser) til diagnostik —
    // uden dette har vi ingen mulighed for at se OM en host som one.com afviser
    // pga. rate-limiting/greylisting, eller om noget reelt er forkert i koden.
    $errorSamples = [];
    foreach ($recipients as $to) {
        smtp_c($sock, "MAIL FROM:<{$user}>");
        $rcptResp = smtp_c($sock, "RCPT TO:<{$to}>");
        if (strncmp($rcptResp, '250', 3) !== 0) {
            $failed++;
            if (count($errorSamples) < 5) $errorSamples[] = 'RCPT: ' . trim($rcptResp);
            continue;
        }
        smtp_c($sock, 'DATA');
        $msg = build_email_message($to, $user, $enc, $text, $htmlSafe);
        $dataResp = smtp_c($sock, $msg);
        if (strncmp($dataResp, '250', 3) === 0) {
            $sent++;
        } else {
            $failed++;
            if (count($errorSamples) < 5) $errorSamples[] = 'DATA: ' . trim($dataResp);
        }
        // Lille pause mellem afsendelser — modvirker hastigheds-baseret
        // rate-limiting/greylisting hos SMTP-udbyderen (kendt problem på one.com
        // webhotel-SMTP ved bulk-udsendelse over én forbindelse).
        usleep(300000);
    }
    fwrite($sock, "QUIT\r\n"); fclose($sock);
    return ['sent' => $sent, 'failed' => $failed, 'errorSamples' => $errorSamples];
}

// Forsvar i dybden — klienten sanitizer allerede med DOMPurify før afsendelse,
// men serveren skal ikke blindt stole på input (kunne i teorien komme uden om klienten).
function sanitize_email_html(string $html): string {
    $html = preg_replace('#<(script|style|iframe|object|embed|form)\b[^>]*>.*?</\1>#is', '', $html);
    $html = preg_replace('#<(script|style|iframe|object|embed|form)\b[^>]*/?>#is', '', $html);
    $html = preg_replace('#\son\w+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)#i', '', $html);
    $html = preg_replace('#(href|src)(\s*=\s*)(["\'])\s*javascript:[^"\']*\3#i', '$1$2$3#$3', $html);
    return $html;
}

// Bygger MIME-besked — multipart/alternative (text + html) hvis HTML er angivet,
// ellers almindelig text/plain. SMTP DATA-transparens: linjer der starter med
// "." skal escapes til ".." (ellers fortolkes linjen som DATA-terminator).
function build_email_message(string $to, string $from, string $subjectEnc, string $text, string $html): string {
    $headers = "Date: " . date('r') . "\r\nFrom: Sejs-Svejbæk IF <{$from}>\r\nTo: {$to}\r\nSubject: {$subjectEnc}\r\nMIME-Version: 1.0\r\n";
    if ($html) {
        $boundary    = 'b' . md5($to . microtime());
        $htmlWrapped = '<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;'
                     . 'line-height:1.6;color:#1a1a1a;">' . $html . '</body></html>';
        $headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n\r\n";
        $body = "--{$boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
              . $text . "\r\n\r\n"
              . "--{$boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
              . $htmlWrapped . "\r\n\r\n"
              . "--{$boundary}--";
    } else {
        $headers .= "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n";
        $body = $text;
    }
    $full = $headers . $body;
    $full = preg_replace('/(\r\n)\./', '$1..', $full);
    if (strpos($full, '.') === 0) $full = '.' . $full;
    return $full . "\r\n.";
}

function get_fs_oauth(array $sa): string {
    $now = time();
    $h   = rtrim(strtr(base64_encode(json_encode(['alg'=>'RS256','typ'=>'JWT'])),'+/','-_'),'=');
    $p   = rtrim(strtr(base64_encode(json_encode(['iss'=>$sa['client_email'],'scope'=>'https://www.googleapis.com/auth/datastore','aud'=>'https://oauth2.googleapis.com/token','iat'=>$now,'exp'=>$now+3600])),'+/','-_'),'=');
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . rtrim(strtr(base64_encode($sig),'+/','-_'),'=');
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http'=>[
        'method'=>'POST','header'=>"Content-Type: application/x-www-form-urlencoded\r\n",
        'content'=>http_build_query(['grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion'=>$jwt]),
        'timeout'=>10,'ignore_errors'=>true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}

function smtp_r($s): string { $o=''; while($l=fgets($s,512)){$o=$l;if(isset($l[3])&&$l[3]===' ')break;} return $o; }
function smtp_c($s, string $c): string { fwrite($s,$c."\r\n"); return smtp_r($s); }
