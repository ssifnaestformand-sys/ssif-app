<?php
/**
 * Hent liste over kladder (journals) fra e-conomic.
 * Kræver admin-login. Bruges til dropdown i backoffice-konfiguration.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
require_once __DIR__ . '/_auth.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { http_response_code(405); echo json_encode(['error' => 'Kun GET']); exit; }

$auth    = trainer_auth();
$fsToken = $auth['fsToken'];
$base    = $auth['base'];

$userDoc = fs_get("{$base}/users/{$auth['uid']}", $fsToken);
$isAdmin = ($userDoc['fields']['isAdmin']['booleanValue'] ?? false)
        || ($userDoc['fields']['role']['stringValue'] ?? '') === 'admin';
if (!$isAdmin) {
    http_response_code(403);
    echo json_encode(['error' => 'Kun admin']);
    exit;
}

$econAppToken = getenv('ECONOMIC_APP_SECRET_TOKEN') ?: '';
$econAgrToken = getenv('ECONOMIC_AGREEMENT_GRANT_TOKEN') ?: '';

if (!$econAppToken || !$econAgrToken) {
    http_response_code(503);
    echo json_encode(['error' => 'e-conomic API-nøgler mangler i servermiljøet']);
    exit;
}

$raw = @file_get_contents('https://restapi.e-conomic.com/journals', false,
    stream_context_create(['http' => [
        'method'        => 'GET',
        'header'        => "X-AppSecretToken: {$econAppToken}\r\nX-AgreementGrantToken: {$econAgrToken}\r\n",
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));

if (!$raw) {
    http_response_code(502);
    echo json_encode(['error' => 'Ingen forbindelse til e-conomic']);
    exit;
}

$data = json_decode($raw, true);
if (!$data || isset($data['httpStatusCode'])) {
    http_response_code(502);
    echo json_encode(['error' => $data['message'] ?? 'Fejl fra e-conomic']);
    exit;
}

$journals = array_map(fn($j) => [
    'nr'   => (int)$j['journalNumber'],
    'navn' => $j['name'] ?? "Journal {$j['journalNumber']}",
], $data['collection'] ?? []);

usort($journals, fn($a, $b) => $a['nr'] <=> $b['nr']);

echo json_encode(['ok' => true, 'journals' => $journals], JSON_UNESCAPED_UNICODE);
