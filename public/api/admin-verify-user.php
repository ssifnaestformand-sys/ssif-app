<?php
/**
 * Admin: verificér en app-bruger manuelt eller gensend verifikationsmail.
 *
 * POST { uid, action: "verify" | "resend" }
 * Kræver admin-rolle i Firestore.
 *
 * "verify" → sætter emailVerified=true i Firebase Auth + Firestore
 * "resend" → sender en ny verifikationsmail via Firebase Auth REST API
 */

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

// ── Auth: kræver admin-rolle ──────────────────────────────────────────────────
$bearerToken = bearer_token();
if (!$bearerToken) { http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit; }

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) { http_response_code(500); echo json_encode(['error' => 'Service account mangler']); exit; }
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

if (!verify_firebase_id_token($bearerToken, $projectId)) {
    http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit;
}

// Hent Firestore-token (datastore-scope) til rolle-tjek og Firestore-opdatering
$fsToken = get_oauth_token($sa, 'https://www.googleapis.com/auth/datastore');
if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'OAuth fejlede']); exit; }

require_role(uid_from_token($bearerToken), $projectId, $fsToken, ['admin']);

// ── Input ──────────────────────────────────────────────────────────────────────
$input  = json_decode(file_get_contents('php://input'), true) ?: [];
$uid    = trim($input['uid']    ?? '');
$action = trim($input['action'] ?? 'verify');

if (!$uid || !preg_match('/^[a-zA-Z0-9_-]{20,128}$/', $uid)) {
    http_response_code(400); echo json_encode(['error' => 'Ugyldigt uid']); exit;
}

// ── Identity Toolkit-token (identitytoolkit-scope) ────────────────────────────
$itToken = get_oauth_token($sa, 'https://www.googleapis.com/auth/identitytoolkit');
if (!$itToken) { http_response_code(500); echo json_encode(['error' => 'Identity Toolkit OAuth fejlede']); exit; }

if ($action === 'verify') {
    // ── Sæt emailVerified=true i Firebase Auth ────────────────────────────────
    $url  = "https://identitytoolkit.googleapis.com/v1/projects/{$projectId}/accounts:update";
    $body = json_encode(['localId' => $uid, 'emailVerified' => true]);
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$itToken}\r\nContent-Type: application/json\r\n",
        'content'       => $body,
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    $data = json_decode($resp ?: '', true);
    if (!isset($data['localId'])) {
        http_response_code(500);
        echo json_encode(['error' => 'Firebase Auth opdatering fejlede', 'detail' => $data['error']['message'] ?? '']);
        exit;
    }

    // ── Opdatér også Firestore ────────────────────────────────────────────────
    $fsUrl  = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/users/{$uid}"
            . '?updateMask.fieldPaths=emailVerified';
    @file_get_contents($fsUrl, false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => ['emailVerified' => ['booleanValue' => true]]]),
        'timeout'       => 5,
        'ignore_errors' => true,
    ]]));

    echo json_encode(['ok' => true, 'verified' => true]);

} elseif ($action === 'resend') {
    // ── Hent brugerens email fra Firebase Auth ────────────────────────────────
    $lookupUrl  = "https://identitytoolkit.googleapis.com/v1/projects/{$projectId}/accounts:lookup";
    $lookupResp = @file_get_contents($lookupUrl, false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$itToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['localId' => [$uid]]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    $lookupData = json_decode($lookupResp ?: '', true);
    $email      = $lookupData['users'][0]['email'] ?? '';

    if (!$email) {
        http_response_code(404); echo json_encode(['error' => 'Bruger ikke fundet eller har ingen email']); exit;
    }

    // ── Send verifikationsmail via Firebase Auth OOB-link ─────────────────────
    // returnOobLink=true returnerer linket til vores SMTP i stedet for at
    // Firebase sender sin egen generiske mail.
    $oobUrl  = "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode";
    $oobResp = @file_get_contents($oobUrl, false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$itToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode([
            'requestType'   => 'VERIFY_EMAIL',
            'email'         => $email,
            'returnOobLink' => true,
        ]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    $oobData = json_decode($oobResp ?: '', true);
    $link    = $oobData['oobLink'] ?? '';

    if (!$link) {
        http_response_code(500);
        echo json_encode(['error' => 'Kunne ikke generere verifikationslink', 'detail' => $oobData['error']['message'] ?? '']);
        exit;
    }

    // ── Send via vores SMTP (noreply@sejssvejbaek-if.dk) ─────────────────────
    $subject = 'Bekræft din emailadresse — Sejs-Svejbæk IF';
    $body    = "Hej,\n\n"
             . "En administrator har bedt om at bekræfte din emailadresse i SSIF-appen.\n\n"
             . "Klik på linket nedenfor for at bekræfte:\n\n"
             . $link . "\n\n"
             . "Linket udløber efter 24 timer.\n\n"
             . "Venlig hilsen\nSejs-Svejbæk IF";

    if (smtp_send($email, $subject, $body)) {
        echo json_encode(['ok' => true, 'email' => $email]);
    } else {
        // Prøv alternativt: lad Firebase sende sin egen mail
        $oobFallback = json_decode(@file_get_contents($oobUrl, false, stream_context_create(['http' => [
            'method'        => 'POST',
            'header'        => "Authorization: Bearer {$itToken}\r\nContent-Type: application/json\r\n",
            'content'       => json_encode(['requestType' => 'VERIFY_EMAIL', 'email' => $email]),
            'timeout'       => 10,
            'ignore_errors' => true,
        ]])) ?: '', true);
        if (isset($oobFallback['email'])) {
            echo json_encode(['ok' => true, 'email' => $email, 'via' => 'firebase']);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Email kunne ikke sendes']);
        }
    }

} elseif ($action === 'delete') {
    // ── Slet bruger fra Firebase Auth ─────────────────────────────────────────
    $delUrl  = "https://identitytoolkit.googleapis.com/v1/projects/{$projectId}/accounts:delete";
    $delResp = @file_get_contents($delUrl, false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$itToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['localId' => $uid]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    $delData = json_decode($delResp ?: '', true);
    // Firebase returnerer tomt objekt {} ved succes
    if (isset($delData['error'])) {
        http_response_code(500);
        echo json_encode(['error' => 'Firebase Auth sletning fejlede: ' . ($delData['error']['message'] ?? '')]);
        exit;
    }

    // ── Slet Firestore-dokument ────────────────────────────────────────────────
    $fsDelUrl = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/users/{$uid}";
    @file_get_contents($fsDelUrl, false, stream_context_create(['http' => [
        'method'        => 'DELETE',
        'header'        => "Authorization: Bearer {$fsToken}\r\n",
        'timeout'       => 5,
        'ignore_errors' => true,
    ]]));

    echo json_encode(['ok' => true, 'deleted' => $uid]);

} else {
    http_response_code(400); echo json_encode(['error' => 'Ukendt action']);
}

// ── Hjælpefunktioner ──────────────────────────────────────────────────────────

function get_oauth_token(array $sa, string $scope): string {
    $now = time();
    $h   = rtrim(strtr(base64_encode(json_encode(['alg'=>'RS256','typ'=>'JWT'])),'+/','-_'),'=');
    $p   = rtrim(strtr(base64_encode(json_encode(['iss'=>$sa['client_email'],'scope'=>$scope,'aud'=>'https://oauth2.googleapis.com/token','iat'=>$now,'exp'=>$now+3600])),'+/','-_'),'=');
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . rtrim(strtr(base64_encode($sig),'+/','-_'),'=');
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http'=>['method'=>'POST','header'=>"Content-Type: application/x-www-form-urlencoded\r\n",'content'=>http_build_query(['grant_type'=>'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion'=>$jwt]),'timeout'=>10,'ignore_errors'=>true]]));
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
    $enc     = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $stuffed = preg_replace('/(\r\n)\./', '$1..', str_replace("\n", "\r\n", $body));
    if (isset($stuffed[0]) && $stuffed[0] === '.') $stuffed = '.' . $stuffed;
    smtp_c($sock, "Date: ".date('r')."\r\nFrom: SSIF App <{$from}>\r\nTo: {$to}\r\nSubject: {$enc}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{$stuffed}\r\n.");
    fwrite($sock, "QUIT\r\n"); fclose($sock); return true;
}
function smtp_r($s): string { $o=''; while($l=fgets($s,512)){$o=$l;if(isset($l[3])&&$l[3]===' ')break;} return $o; }
function smtp_c($s, string $c): string { fwrite($s,$c."\r\n"); return smtp_r($s); }
