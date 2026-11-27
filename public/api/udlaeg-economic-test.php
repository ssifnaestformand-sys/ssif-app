<?php
/**
 * Test e-conomic forbindelsen ved at slå ressourcer op via GET.
 * Opretter ingenting — verificerer kun at journal, konto og leverandør eksisterer.
 *
 * POST { journalNr: int, accountNumber: int, creditorNumber: int }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
require_once __DIR__ . '/_auth.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

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

$raw           = json_decode(file_get_contents('php://input'), true) ?: [];
$journalNr     = (int)($raw['journalNr']     ?? 0);
$accountNumber = (int)($raw['accountNumber'] ?? 0);
$creditorNr    = (int)($raw['creditorNumber']?? 0);

function econ_get(string $url, string $appToken, string $agrToken): array {
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'GET',
        'header'        => "X-AppSecretToken: {$appToken}\r\nX-AgreementGrantToken: {$agrToken}\r\n",
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    $statusLine = ($http_response_header ?? ['HTTP/1.1 000 Ingen forbindelse'])[0];
    preg_match('/HTTP\/\d\.\d (\d{3})/', $statusLine, $m);
    $httpStatus = (int)($m[1] ?? 0);
    $data       = $resp ? (json_decode($resp, true) ?? []) : [];
    return ['status' => $httpStatus, 'data' => $data];
}

$results = [];

// ── 1. Journal (via legacy REST API — det er der vi poster til) ──────────────
if ($journalNr) {
    $r = econ_get("https://restapi.e-conomic.com/journals/{$journalNr}", $econAppToken, $econAgrToken);
    $results['journal'] = [
        'nr'     => $journalNr,
        'ok'     => $r['status'] === 200,
        'status' => $r['status'],
        'navn'   => $r['data']['name'] ?? ($r['data']['message'] ?? null),
    ];
} else {
    $results['journal'] = ['ok' => false, 'status' => 0, 'navn' => 'Intet journal-nummer konfigureret'];
}

// ── 2. GL-konto (via legacy REST API) ────────────────────────────────────────
if ($accountNumber) {
    $r = econ_get("https://restapi.e-conomic.com/accounts/{$accountNumber}", $econAppToken, $econAgrToken);
    $results['konto'] = [
        'nr'     => $accountNumber,
        'ok'     => $r['status'] === 200,
        'status' => $r['status'],
        'navn'   => $r['data']['name'] ?? ($r['data']['message'] ?? null),
    ];
} else {
    $results['konto'] = ['ok' => false, 'status' => 0, 'navn' => 'Intet kontonummer angivet'];
}

// ── 3. Leverandør (via legacy REST API) — kun hvis sat ───────────────────────
if ($creditorNr) {
    $r = econ_get("https://restapi.e-conomic.com/suppliers/{$creditorNr}", $econAppToken, $econAgrToken);
    $results['leverandoer'] = [
        'nr'     => $creditorNr,
        'ok'     => $r['status'] === 200,
        'status' => $r['status'],
        'navn'   => $r['data']['name'] ?? ($r['data']['message'] ?? null),
    ];
} else {
    $results['leverandoer'] = ['ok' => null, 'navn' => 'Intet kreditornummer konfigureret'];
}

echo json_encode(['ok' => true, 'results' => $results], JSON_UNESCAPED_UNICODE);
