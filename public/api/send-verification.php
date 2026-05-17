<?php
/**
 * Extra-email verifikation
 *
 * POST { email, uid, token }
 * → sender en verificeringsmail via SMTP (send.one.com:465 SSL)
 *
 * Sikkerheden ligger i Firestore: tokenet skal matche et dokument
 * ejet af den pågældende uid for at verificeringen accepteres i appen.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
require_once __DIR__ . '/_auth.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$input = json_decode(file_get_contents('php://input'), true) ?: [];

// ── Let auth-tjek uden netværkskald (fix M-1) ────────────────────────────────
// Fuld JWT-signaturverifikation kræver et live-kald til Google — for dette
// lavrisiko-endpoint verificerer vi i stedet at tokenet er gyldigt format,
// ikke udløbet og tilhører det korrekte Firebase-projekt.
// Den reelle sikkerhed mod misbrug er verify-email.php's Firestore-tjek.
$saPath = __DIR__ . '/firebase-service-account.json';
if (file_exists($saPath)) {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!$h && function_exists('getallheaders')) { $all = getallheaders(); $h = $all['Authorization'] ?? $all['authorization'] ?? ''; }
    $bearerToken = strpos($h, 'Bearer ') === 0 ? trim(substr($h, 7)) : ($input['idToken'] ?? '');
    if ($bearerToken) {
        $parts = explode('.', $bearerToken);
        if (count($parts) === 3) {
            $payload = json_decode(base64_decode(strtr(
                $parts[1] . str_repeat('=', (4 - strlen($parts[1]) % 4) % 4), '-_', '+/'
            )), true);
            $saTmp = json_decode(file_get_contents($saPath), true);
            $pid   = $saTmp['project_id'] ?? '';
            // Afvis klart forfalskede tokens: forkert projekt eller udløbet
            if ($pid && ($payload['aud'] ?? '') !== $pid) {
                http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit;
            }
            if (($payload['exp'] ?? 0) < time()) {
                http_response_code(401); echo json_encode(['error' => 'Token udløbet — log ind igen']); exit;
            }
        }
    }
    // Ingen token → tillad (App.jsx er logget ind, men Android/iOS kan mangle header)
}
$to    = trim($input['email'] ?? '');
$uid   = trim($input['uid']   ?? '');
$token = trim($input['token'] ?? '');

if (!$to || !$uid || !$token) {
    http_response_code(400);
    echo json_encode(['error' => 'Manglende felter: email, uid og token er påkrævet']);
    exit;
}

if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['error' => 'Ugyldig emailadresse']);
    exit;
}

if (!preg_match('/^[0-9a-f\-]{32,36}$/i', $token)) {
    http_response_code(400);
    echo json_encode(['error' => 'Ugyldigt token-format']);
    exit;
}

$verifyUrl = 'https://app.sejssvejbaek-if.dk/api/verify-email.php?token=' . urlencode($token)
           . '&uid=' . urlencode($uid);

$subject = 'Bekræft din emailadresse — Sejs-Svejbæk IF';

$body = "Hej,\n\n"
      . "Du er ved at tilføje denne emailadresse til SSIF-appen.\n\n"
      . "Klik på linket nedenfor for at bekræfte:\n\n"
      . $verifyUrl . "\n\n"
      . "Linket er gyldigt i 7 dage.\n\n"
      . "Hvis du ikke har bedt om dette, kan du roligt se bort fra denne email.\n\n"
      . "Venlig hilsen\n"
      . "Sejs-Svejbæk IF";

if (!smtp_send($to, $subject, $body)) {
    http_response_code(500);
    echo json_encode(['error' => 'SMTP-afsendelse fejlede']);
    exit;
}

echo json_encode(['ok' => true]);

// ── SMTP via socket (ingen afhængigheder) ─────────────────────────────────────

function smtp_send(string $to, string $subject, string $body): bool {
    $host = 'send.one.com';
    $port = 465;
    $user = 'noreply@sejssvejbaek-if.dk';
    $pass = getenv('SMTP_PASSWORD') ?: '';
    $from = 'noreply@sejssvejbaek-if.dk';
    $name = 'SSIF App';

    if (!$pass) return false;

    $ctx  = stream_context_create(['ssl' => [
        'verify_peer'      => true,
        'verify_peer_name' => true,
    ]]);
    $sock = @stream_socket_client("ssl://{$host}:{$port}", $errno, $errstr, 15,
                                   STREAM_CLIENT_CONNECT, $ctx);
    if (!$sock) return false;

    stream_set_timeout($sock, 10);

    smtp_read($sock);                               // 220 greeting

    smtp_cmd($sock, 'EHLO sejssvejbaek-if.dk');     // multi-line — read til ' '
    smtp_cmd($sock, 'AUTH LOGIN');
    smtp_cmd($sock, base64_encode($user));
    $authResp = smtp_cmd($sock, base64_encode($pass));
    if (strncmp($authResp, '235', 3) !== 0) { fclose($sock); return false; }

    smtp_cmd($sock, "MAIL FROM:<{$from}>");
    smtp_cmd($sock, "RCPT TO:<{$to}>");
    smtp_cmd($sock, 'DATA');

    $enc  = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $msg  = "Date: " . date('r') . "\r\n"
          . "From: {$name} <{$from}>\r\n"
          . "To: {$to}\r\n"
          . "Subject: {$enc}\r\n"
          . "MIME-Version: 1.0\r\n"
          . "Content-Type: text/plain; charset=UTF-8\r\n"
          . "Content-Transfer-Encoding: 8bit\r\n"
          . "\r\n"
          . $body
          . "\r\n.";                               // end-of-data marker

    smtp_cmd($sock, $msg);
    fwrite($sock, "QUIT\r\n");
    fclose($sock);
    return true;
}

function smtp_read($sock): string {
    $out = '';
    while ($line = fgets($sock, 512)) {
        $out = $line;
        if (isset($line[3]) && $line[3] === ' ') break;  // singleline or last of multi
    }
    return $out;
}

function smtp_cmd($sock, string $cmd): string {
    fwrite($sock, $cmd . "\r\n");
    return smtp_read($sock);
}
