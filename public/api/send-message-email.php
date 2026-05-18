<?php
/**
 * Send email notifications when a trainer posts a message.
 *
 * POST { holdIds: string[], senderName: string, text: string, holdNavn: string }
 * Requires admin or trainer role.
 *
 * Queries Firestore for users with emailNotifications=true whose holdIds
 * overlap with the message's holdIds, then sends each one an email via SMTP.
 */

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

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
$fsToken   = get_fs_token($sa);
if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'OAuth fejlede']); exit; }

require_role($callerUid, $projectId, $fsToken, ['admin', 'trainer']);

// ── Input ──────────────────────────────────────────────────────────────────────
$input      = json_decode(file_get_contents('php://input'), true) ?: [];
$targetIds  = array_map('strval', (array)($input['holdIds']    ?? []));
$senderName = trim($input['senderName'] ?? '');
$msgText    = trim($input['text']       ?? '');
$holdNavn   = trim($input['holdNavn']   ?? '');

if (empty($targetIds) || !$msgText) {
    http_response_code(400); echo json_encode(['error' => 'holdIds og text er påkrævet']); exit;
}

$targetSet = array_flip($targetIds); // for O(1) lookup

// ── Hent brugere med emailNotifications=true fra Firestore ───────────────────
$queryUrl = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:runQuery";
$query = [
    'structuredQuery' => [
        'from'  => [['collectionId' => 'users']],
        'where' => [
            'fieldFilter' => [
                'field' => ['fieldPath' => 'emailNotifications'],
                'op'    => 'EQUAL',
                'value' => ['booleanValue' => true],
            ],
        ],
        'limit' => 2000,
    ],
];

$resp = @file_get_contents($queryUrl, false, stream_context_create(['http' => [
    'method'        => 'POST',
    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode($query),
    'timeout'       => 15,
    'ignore_errors' => true,
]]));

$rows = json_decode($resp ?: '[]', true);

// ── Filter + send ─────────────────────────────────────────────────────────────
$sent    = 0;
$skipped = 0;

foreach ($rows as $row) {
    if (!isset($row['document']['fields'])) continue;
    $fields = $row['document']['fields'];

    // Brugerens hold-IDs (fra holdIds-feltet)
    $userHoldIds = [];
    if (isset($fields['holdIds']['arrayValue']['values'])) {
        foreach ($fields['holdIds']['arrayValue']['values'] as $v) {
            $userHoldIds[] = (string)($v['stringValue'] ?? $v['integerValue'] ?? '');
        }
    }

    // Tjek overlap
    $overlap = false;
    foreach ($userHoldIds as $id) {
        if (isset($targetSet[$id])) { $overlap = true; break; }
    }
    if (!$overlap) { $skipped++; continue; }

    // Hent email — primær login-email
    $email = trim($fields['email']['stringValue'] ?? $fields['primaryEmail']['stringValue'] ?? '');
    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $skipped++; continue; }

    $holdLabel = $holdNavn ?: implode(', ', $targetIds);
    $subject   = "Ny besked fra {$senderName} — Sejs-Svejbæk IF";
    $body      = "Hej,\n\n"
               . "{$senderName} har sendt en besked til {$holdLabel}:\n\n"
               . "---\n"
               . wordwrap($msgText, 72, "\n", false)
               . "\n---\n\n"
               . "Åbn SSIF-appen for at svare eller se mere.\n\n"
               . "Du modtager disse emails fordi du har slået email-notifikationer\n"
               . "til under Profil → Indstillinger i SSIF-appen.\n\n"
               . "Venlig hilsen\nSejs-Svejbæk IF";

    if (smtp_send($email, $subject, $body)) {
        $sent++;
    } else {
        $skipped++;
    }
}

echo json_encode(['ok' => true, 'sent' => $sent, 'skipped' => $skipped]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function get_fs_token(array $sa): string {
    $now = time();
    $h   = rtrim(strtr(base64_encode(json_encode(['alg'=>'RS256','typ'=>'JWT'])),'+/','-_'),'=');
    $p   = rtrim(strtr(base64_encode(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/datastore',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
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
         . "From: SSIF App <{$from}>\r\n"
         . "To: {$to}\r\n"
         . "Subject: {$enc}\r\n"
         . "MIME-Version: 1.0\r\n"
         . "Content-Type: text/plain; charset=UTF-8\r\n"
         . "Content-Transfer-Encoding: 8bit\r\n"
         . "\r\n"
         . $body
         . "\r\n.";
    smtp_c($sock, $msg);
    fwrite($sock, "QUIT\r\n");
    fclose($sock);
    return true;
}
function smtp_r($s): string { $o=''; while($l=fgets($s,512)){ $o=$l; if(isset($l[3])&&$l[3]===' ')break; } return $o; }
function smtp_c($s, string $c): string { fwrite($s,$c."\r\n"); return smtp_r($s); }
