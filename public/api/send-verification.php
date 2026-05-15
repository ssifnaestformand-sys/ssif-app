<?php
/**
 * Extra-email verifikation
 *
 * POST { email, uid, token }
 * → sender en verificeringsmail til den angivne adresse med et link
 *   der peger tilbage på appen med token+uid som query-parametre.
 *
 * Sikkerheden ligger i Firestore: tokenet skal matche et dokument
 * ejet af den pågældende uid for at verificeringen accepteres i appen.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$input = json_decode(file_get_contents('php://input'), true) ?: [];
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

// Tokenet må kun indeholde hex + bindestreger (UUID-format)
if (!preg_match('/^[0-9a-f\-]{32,36}$/i', $token)) {
    http_response_code(400);
    echo json_encode(['error' => 'Ugyldigt token-format']);
    exit;
}

$verifyUrl = 'https://app.sejssvejbaek-if.dk/?verifyEmail=' . urlencode($token)
           . '&uid=' . urlencode($uid);

$subject = 'Bekræft din emailadresse — Sejs-Svejbæk IF';

$body = "Hej,\n\n"
      . "Du er ved at tilføje denne emailadresse til SSIF-appen på\n"
      . "Sejs-Svejbæk IF.\n\n"
      . "Klik på linket nedenfor for at bekræfte:\n\n"
      . $verifyUrl . "\n\n"
      . "Linket er gyldigt i 7 dage.\n\n"
      . "Hvis du ikke har bedt om dette, kan du roligt se bort fra denne email.\n\n"
      . "Venlig hilsen\n"
      . "Sejs-Svejbæk IF";

$from    = 'noreply@sejssvejbaek-if.dk';
$headers = implode("\r\n", [
    'From: Sejs-Svejbaek IF <' . $from . '>',
    'Reply-To: ' . $from,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: PHP/' . PHP_VERSION,
]);

// mb_encode_mimeheader koder emnet korrekt som UTF-8 MIME
$encodedSubject = mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n");

$sent = mail($to, $encodedSubject, $body, $headers);

if ($sent) {
    echo json_encode(['ok' => true]);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Serveren kunne ikke sende emailen']);
}
