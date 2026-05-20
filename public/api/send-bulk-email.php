<?php
/**
 * Admin: Send bulk email via SMTP (noreply@sejssvejbaek-if.dk)
 *
 * POST { action:'preview'|'send', scope:'all'|'gruppe',
 *        hold_ids?:string[], subject:string, text:string }
 * Kun admin.
 *
 * preview → henter Conventus-emails, returnerer { count }
 * send    → henter Conventus-emails, sender via SMTP, logger til kommunikation_logs
 *
 * Email-adresser gemmes ALDRIG — hverken i log eller svar.
 */

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

set_time_limit(180);
ignore_user_abort(true);

// ── Auth: kun admin ───────────────────────────────────────────────────────────
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
$fsToken   = get_access_token($sa, 'https://www.googleapis.com/auth/datastore');
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
$rawIds     = (array)($input['hold_ids'] ?? []);
$targetGroupIds = array_values(array_unique(array_filter(array_map('intval', $rawIds))));

if (!$subject)  { http_response_code(400); echo json_encode(['error' => 'Emne er tomt']); exit; }
if (!$text)     { http_response_code(400); echo json_encode(['error' => 'Besked er tom']); exit; }
if (!in_array($action, ['preview', 'send'], true)) { http_response_code(400); echo json_encode(['error' => 'Ukendt action']); exit; }

// ── Conventus API-nøgle ───────────────────────────────────────────────────────
$conventusKey = getenv('CONVENTUS_KEY') ?: '';
if (!$conventusKey) {
    foreach ([__DIR__ . '/.env', __DIR__ . '/../../.env'] as $p) {
        if (file_exists($p)) { $e = parse_ini_file($p); if (!empty($e['CONVENTUS_KEY'])) { $conventusKey = $e['CONVENTUS_KEY']; break; } }
    }
}
if (!$conventusKey) { http_response_code(500); echo json_encode(['error' => 'CONVENTUS_KEY ikke konfigureret']); exit; }

// ── Hent emails fra Conventus ─────────────────────────────────────────────────
$dbgResult = fetch_conventus_emails_debug($conventusKey, $targetGroupIds);
$emails    = $dbgResult['emails'];

if ($action === 'preview') {
    echo json_encode(['ok' => true, 'count' => count($emails), 'debug' => [
        'hold_ids_received' => $targetGroupIds,
        'conventus_fetched' => $dbgResult['total'],
        'conventus_ok'      => $dbgResult['api_ok'],
        'sample_groups'     => $dbgResult['sample_groups'],
    ]]);
    exit;
}

// ── Send emails ────────────────────────────────────────────────────────────────
$smtpPass = getenv('SMTP_PASSWORD') ?: '';
if (!$smtpPass) { http_response_code(503); echo json_encode(['error' => 'SMTP ikke konfigureret']); exit; }

if (empty($emails)) {
    echo json_encode(['ok' => true, 'sent' => 0, 'failed' => 0, 'message' => 'Ingen modtagere fundet']);
    exit;
}

$result = smtp_bulk_send($emails, $subject, $text, $smtpPass);

// ── Log til Firestore (ingen email-adresser) ──────────────────────────────────
$logFields = [
    'sentAt'       => ['timestampValue' => gmdate('Y-m-d\TH:i:s\Z')],
    'channel'      => ['stringValue'    => 'email'],
    'senderUid'    => ['stringValue'    => $callerUid],
    'senderName'   => ['stringValue'    => $callerName],
    'scope'        => ['stringValue'    => $scope . ($scopeLabel ? ":{$scopeLabel}" : '')],
    'recipients'   => ['integerValue'   => (string)$result['sent']],
    'failed'       => ['integerValue'   => (string)$result['failed']],
    'subject'      => ['stringValue'    => $subject],
    'text'         => ['stringValue'    => $text],
    'ok'           => ['booleanValue'   => $result['sent'] > 0],
];
@file_get_contents(
    "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/kommunikation_logs",
    false, stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content' => json_encode(['fields' => $logFields]),
        'timeout' => 10, 'ignore_errors' => true,
    ]])
);

if ($result['sent'] === 0 && $result['failed'] > 0) {
    http_response_code(502);
    echo json_encode(['error' => 'SMTP-afsendelse fejlede for alle modtagere', 'failed' => $result['failed']]);
} else {
    echo json_encode(['ok' => true, 'sent' => $result['sent'], 'failed' => $result['failed']]);
}

// ═══════════════════════════════════════════════════════════════════════════════

function fetch_conventus_emails_debug(string $apiKey, array $targetGroupIds): array {
    $ctx = stream_context_create(['http' => ['timeout' => 90, 'ignore_errors' => true]]);
    $url = 'https://www.conventus.dk/dataudv/api/adressebog/get_medlemmer.php?' . http_build_query([
        'forening' => '1031', 'key' => $apiKey, 'relationer' => 'true',
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if (!$raw) return ['emails' => [], 'total' => 0, 'api_ok' => false, 'sample_groups' => []];

    if (preg_match('/encoding=["\']ISO-8859-1["\']/i', $raw)) {
        $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
        $raw = preg_replace('/encoding=["\']ISO-8859-1["\']/i', 'encoding="UTF-8"', $raw);
    }
    if (strpos(ltrim($raw), '<') !== 0)
        return ['emails' => [], 'total' => 0, 'api_ok' => false, 'sample_groups' => []];

    $targetSet     = array_flip($targetGroupIds);
    $filterByGroup = !empty($targetGroupIds);
    libxml_use_internal_errors(true);
    $reader = new XMLReader();
    if (!$reader->XML($raw, 'UTF-8', LIBXML_NOERROR | LIBXML_NOWARNING))
        return ['emails' => [], 'total' => 0, 'api_ok' => false, 'sample_groups' => []];

    $seen = []; $total = 0; $sampleGroups = [];

    while ($reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT) continue;
        if (strtolower($reader->localName) !== 'medlem') continue;
        if ($reader->depth !== 2) continue;
        $xml = $reader->readOuterXml(); $reader->next();
        if (!$xml) continue;
        $k = @simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NOERROR | LIBXML_NOWARNING);
        if (!$k) continue;
        if (strtolower(trim((string)($k->slettet ?? ''))) === 'true') { unset($k); continue; }
        if (strtolower(trim((string)($k->off_email ?? 'true'))) === 'false') { unset($k); continue; }

        $total++;

        // Indsaml gruppe-IDs fra de første 3 membres til debug
        if (count($sampleGroups) < 3 && isset($k->relationer)) {
            $gids = [];
            foreach ($k->relationer->children() as $relType) {
                foreach ($relType->children() as $child) {
                    if (strtolower($child->getName()) === 'gruppe') $gids[] = (int)trim((string)$child);
                }
            }
            $sampleGroups[] = ['name' => trim((string)($k->navn ?? '')), 'groups' => $gids];
        }

        if ($filterByGroup) {
            $inGroup = false;
            if (isset($k->relationer)) {
                foreach ($k->relationer->children() as $relType) {
                    foreach ($relType->children() as $child) {
                        if (strtolower($child->getName()) !== 'gruppe') continue;
                        if (isset($targetSet[(int)trim((string)$child)])) { $inGroup = true; break 2; }
                    }
                }
            }
            if (!$inGroup) { unset($k); continue; }
        }

        $email = strtolower(trim((string)($k->email ?? '')));
        if ($email && filter_var($email, FILTER_VALIDATE_EMAIL)) $seen[$email] = true;
        unset($k);
    }
    $reader->close();
    libxml_clear_errors();
    return ['emails' => array_keys($seen), 'total' => $total, 'api_ok' => true, 'sample_groups' => $sampleGroups];
}

// Alias uden debug (bruges ved send)
function fetch_conventus_emails(string $apiKey, array $targetGroupIds): array {
    return fetch_conventus_emails_debug($apiKey, $targetGroupIds)['emails'];
}

// Bulk SMTP: én forbindelse, alle emails igennem den
function smtp_bulk_send(array $recipients, string $subject, string $bodyText, string $pass): array {
    $host = 'send.one.com'; $port = 465;
    $user = 'noreply@sejssvejbaek-if.dk';

    $ctx  = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $sock = @stream_socket_client("ssl://{$host}:{$port}", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$sock) return ['sent' => 0, 'failed' => count($recipients)];
    stream_set_timeout($sock, 15);

    smtp_r($sock);
    smtp_c($sock, 'EHLO sejssvejbaek-if.dk');
    smtp_c($sock, 'AUTH LOGIN');
    smtp_c($sock, base64_encode($user));
    $auth = smtp_c($sock, base64_encode($pass));
    if (strncmp($auth, '235', 3) !== 0) { fclose($sock); return ['sent' => 0, 'failed' => count($recipients)]; }

    $sent = 0; $failed = 0;
    $subjectEnc = '=?UTF-8?B?' . base64_encode($subject) . '?=';

    foreach ($recipients as $to) {
        smtp_c($sock, "MAIL FROM:<{$user}>");
        $rcpt = smtp_c($sock, "RCPT TO:<{$to}>");
        if (strncmp($rcpt, '250', 3) !== 0) { $failed++; continue; }
        smtp_c($sock, 'DATA');
        $msg = "Date: " . date('r') . "\r\n"
             . "From: Sejs-Svejbaek IF <{$user}>\r\n"
             . "To: {$to}\r\n"
             . "Subject: {$subjectEnc}\r\n"
             . "MIME-Version: 1.0\r\n"
             . "Content-Type: text/plain; charset=UTF-8\r\n"
             . "Content-Transfer-Encoding: 8bit\r\n"
             . "\r\n"
             . $bodyText
             . "\r\n"
             . "---\r\n"
             . "Du modtager denne email fordi du er tilknyttet Sejs-Svejbæk IF.\r\n"
             . "\r\n.";
        $dataResp = smtp_c($sock, $msg);
        if (strncmp($dataResp, '250', 3) === 0) $sent++; else $failed++;
    }

    fwrite($sock, "QUIT\r\n");
    fclose($sock);
    return ['sent' => $sent, 'failed' => $failed];
}

function get_access_token(array $sa, string $scope): string {
    $now = time();
    $h   = rtrim(strtr(base64_encode(json_encode(['alg'=>'RS256','typ'=>'JWT'])),'+/','-_'),'=');
    $p   = rtrim(strtr(base64_encode(json_encode(['iss'=>$sa['client_email'],'scope'=>$scope,'aud'=>'https://oauth2.googleapis.com/token','iat'=>$now,'exp'=>$now+3600])),'+/','-_'),'=');
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
