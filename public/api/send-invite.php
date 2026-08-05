<?php
/**
 * Opret backoffice-invitation og send invitations-email.
 *
 * POST { email, role: 'admin'|'trainer', permissions: string[]|null, inviterName }
 * Kræver admin-rolle.
 * Returnerer: { ok: true, emailSent: bool } | { error: string }
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
$fsToken   = get_fs_oauth($sa);
if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'OAuth fejlede']); exit; }

require_role($callerUid, $projectId, $fsToken, ['admin']);

// ── Input ──────────────────────────────────────────────────────────────────────
$input       = json_decode(file_get_contents('php://input'), true) ?: [];
$email       = strtolower(trim($input['email']       ?? ''));
$role        = $input['role']        ?? 'trainer';
$permissions = $input['permissions'] ?? null;
$inviterName = trim($input['inviterName'] ?? 'En administrator');

if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400); echo json_encode(['error' => 'Ugyldig email-adresse']); exit;
}
if (!in_array($role, ['admin', 'trainer'], true)) {
    http_response_code(400); echo json_encode(['error' => 'Ugyldig rolle']); exit;
}

// ── Skriv invitation til Firestore (email som dokument-ID) ────────────────────
$apiBase  = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents";
$invDocId = rawurlencode($email);
$invUrl   = "{$apiBase}/invitations/{$invDocId}";

$fields = [
    'email'       => ['stringValue'    => $email],
    'role'        => ['stringValue'    => $role],
    'invitedBy'   => ['stringValue'    => $inviterName],
    'invitedAt'   => ['timestampValue' => gmdate('Y-m-d\TH:i:s\Z')],
];

if (is_array($permissions)) {
    $fields['permissions'] = ['arrayValue' => [
        'values' => array_map(fn($p) => ['stringValue' => (string)$p], $permissions),
    ]];
} else {
    $fields['permissions'] = ['nullValue' => null];
}

$invResp = @file_get_contents($invUrl, false, stream_context_create(['http' => [
    'method'        => 'PATCH',
    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode(['fields' => $fields]),
    'timeout'       => 10,
    'ignore_errors' => true,
]]));

$invData = $invResp ? json_decode($invResp, true) : null;
if (!$invResp || isset($invData['error'])) {
    http_response_code(500);
    echo json_encode(['error' => 'Kunne ikke oprette invitation: ' . ($invData['error']['message'] ?? 'ukendt fejl')]);
    exit;
}

// ── Send invitations-email via SMTP ───────────────────────────────────────────
$smtpPass    = getenv('SMTP_PASSWORD') ?: '';
$roleName    = $role === 'admin' ? 'Superadmin' : 'Redaktør';
$backofficeUrl = 'https://app.sejssvejbaek-if.dk/admin/';

$subject = 'Invitation til SSIF Backoffice';
$body    = "Hej,\n\n"
         . "{$inviterName} har inviteret dig til Sejs-Svejbæk IF's backoffice som {$roleName}.\n\n"
         . "Log ind med din Google-konto eller email/adgangskode på:\n"
         . "{$backofficeUrl}\n\n"
         . "Husk at bruge den email-adresse, som denne invitation er sendt til ({$email}).\n\n"
         . "Med venlig hilsen\n"
         . "Sejs-Svejbæk IF";

$emailSent = false;
if ($smtpPass) {
    $emailSent = smtp_send_one($email, $subject, $body, $smtpPass);
}

echo json_encode(['ok' => true, 'emailSent' => $emailSent]);

// ─────────────────────────────────────────────────────────────────────────────

function smtp_send_one(string $to, string $subject, string $body, string $pass): bool {
    $host = 'send.one.com'; $port = 465;
    $user = 'noreply@sejssvejbaek-if.dk';
    $ctx  = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $sock = @stream_socket_client("ssl://{$host}:{$port}", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$sock) return false;
    stream_set_timeout($sock, 15);
    sr($sock); sc($sock, 'EHLO sejssvejbaek-if.dk');
    sc($sock, 'AUTH LOGIN'); sc($sock, base64_encode($user));
    if (strncmp(sc($sock, base64_encode($pass)), '235', 3) !== 0) { fclose($sock); return false; }
    sc($sock, "MAIL FROM:<{$user}>");
    if (strncmp(sc($sock, "RCPT TO:<{$to}>"), '250', 3) !== 0) { fclose($sock); return false; }
    sc($sock, 'DATA');
    $enc      = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $stuffed  = preg_replace('/(\r\n)\./', '$1..', str_replace("\n", "\r\n", $body));
    if (isset($stuffed[0]) && $stuffed[0] === '.') $stuffed = '.' . $stuffed;
    $msg = "Date: " . date('r') . "\r\nFrom: Sejs-Svejbæk IF <{$user}>\r\nTo: {$to}\r\nSubject: {$enc}\r\n"
         . "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
         . $stuffed . "\r\n.";
    $ok = strncmp(sc($sock, $msg), '250', 3) === 0;
    fwrite($sock, "QUIT\r\n"); fclose($sock);
    return $ok;
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

function sr($s): string { $o=''; while($l=fgets($s,512)){$o=$l;if(isset($l[3])&&$l[3]===' ')break;} return $o; }
function sc($s, string $c): string { fwrite($s,$c."\r\n"); return sr($s); }
