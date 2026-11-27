<?php
/**
 * Gem udlæg-konfiguration (kun admin).
 *
 * POST {
 *   bogholder_email:          string,
 *   hb_formand_email:         string,
 *   godkendelse_graense:      int,
 *   economic_supplier_nr:      int,       // valgfrit
 *   economic_payment_terms_nr: int,      // valgfrit
 *   afdelinger: {
 *     "Fodbold U9": { navn: string, formand_email: string },
 *     ...
 *   }
 * }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
require_once __DIR__ . '/_auth.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$auth      = trainer_auth();
$fsToken   = $auth['fsToken'];
$projectId = $auth['projectId'];
$base      = $auth['base'];

// Kun admin
$userDoc = fs_get("{$base}/users/{$auth['uid']}", $fsToken);
$isAdmin = ($userDoc['fields']['isAdmin']['booleanValue'] ?? false)
        || ($userDoc['fields']['role']['stringValue'] ?? '') === 'admin';
if (!$isAdmin) {
    http_response_code(403);
    echo json_encode(['error' => 'Kun admin kan ændre udlæg-konfiguration']);
    exit;
}

$raw = json_decode(file_get_contents('php://input'), true) ?: [];

$bogholderEmail  = trim($raw['bogholder_email']         ?? '');
$hbEmail         = trim($raw['hb_formand_email']        ?? '');
$graense         = (int)($raw['godkendelse_graense']    ?? 100000);
$supplierNr      = (int)($raw['economic_supplier_nr']      ?? 0);
$paymentTermsNr  = (int)($raw['economic_payment_terms_nr'] ?? 0);
$afdelinger      = $raw['afdelinger'] ?? [];

if (!is_array($afdelinger)) $afdelinger = [];

$fields = [
    'bogholder_email'         => ['stringValue'  => $bogholderEmail],
    'hb_formand_email'        => ['stringValue'  => $hbEmail],
    'godkendelse_graense'     => ['integerValue' => (string)$graense],
    'afdelinger'              => ['stringValue'  => json_encode($afdelinger, JSON_UNESCAPED_UNICODE)],
];
if ($supplierNr)     $fields['economic_supplier_nr']      = ['integerValue' => (string)$supplierNr];
if ($paymentTermsNr) $fields['economic_payment_terms_nr'] = ['integerValue' => (string)$paymentTermsNr];

$resp = @file_get_contents("{$base}/settings/udlaeg_config", false, stream_context_create(['http' => [
    'method'        => 'PATCH',
    'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
    'content'       => json_encode(['fields' => $fields]),
    'timeout'       => 10,
    'ignore_errors' => true,
]]));

if (!$resp) {
    http_response_code(500);
    echo json_encode(['error' => 'Kunne ikke gemme konfiguration']);
    exit;
}

$data = json_decode($resp, true);
if (isset($data['error'])) {
    http_response_code(500);
    echo json_encode(['error' => $data['error']['message'] ?? 'Firestore fejl']);
    exit;
}

echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
