<?php
/**
 * Admin: send SMS via GatewayAPI
 *
 * POST { action:'preview'|'send', scope:'all'|'afdeling'|'hold'|'manual',
 *        scope_id?:string, manual_input?:string, text:string }
 *
 * preview → henter Conventus-numre, returnerer { count, parts, estimatedCost }
 * send    → henter Conventus-numre, sender via GatewayAPI, logger til Firestore
 *
 * PERSONSIKKERHED: Telefonnumre gemmes ALDRIG — hverken i Firestore,
 * log, svar eller server-disk.
 *
 * Anbefalede Secrets (GitHub → Settings → Secrets):
 *   SMS_API_KEY  — GatewayAPI Token (https://gatewayapi.com)
 */

define('SMS_PRICE_DKK', 0.40); // estimat pr. SMS-del (GatewayAPI, Danmark)

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

set_time_limit(120);
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

// Hent OAuth token til Firestore og rolle-tjek
$fsToken = make_access_token($sa, 'https://www.googleapis.com/auth/datastore');
if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'OAuth fejlede']); exit; }

require_role($callerUid, $projectId, $fsToken, ['admin']);

// ── Hent afsender-navn til log ─────────────────────────────────────────────────
$callerName = 'Ukendt admin';
$callerDoc = @file_get_contents(
    "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/users/{$callerUid}",
    false, stream_context_create(['http' => [
        'header' => "Authorization: Bearer {$fsToken}\r\n",
        'timeout' => 5, 'ignore_errors' => true,
    ]])
);
if ($callerDoc) {
    $cd = json_decode($callerDoc, true);
    $callerName = $cd['fields']['displayName']['stringValue'] ?? $callerName;
}

// ── Input ──────────────────────────────────────────────────────────────────────
$input       = json_decode(file_get_contents('php://input'), true) ?: [];
$action      = trim($input['action']       ?? 'preview');
$scope       = trim($input['scope']        ?? 'all');
$scopeLabel  = trim($input['scope_label']  ?? '');
$manualInput = trim($input['manual_input'] ?? '');
$text        = trim($input['text']         ?? '');

if (!$text)                   { http_response_code(400); echo json_encode(['error' => 'Besked er tom']); exit; }
if (mb_strlen($text) > 480)   { http_response_code(400); echo json_encode(['error' => 'Besked er for lang (max 480 tegn)']); exit; }
if (!in_array($action, ['preview', 'send'], true)) { http_response_code(400); echo json_encode(['error' => 'Ukendt action']); exit; }
if (!in_array($scope, ['all', 'gruppe', 'manual'], true)) { http_response_code(400); echo json_encode(['error' => 'Ukendt scope']); exit; }

$parts = sms_parts($text);

// ── Manuel scope: parse numre direkte, ingen Conventus-kald ──────────────────
if ($scope === 'manual') {
    $msisdns = parse_manual_numbers($manualInput);
    if ($action === 'preview') {
        echo json_encode(['ok' => true, 'count' => count($msisdns), 'parts' => $parts,
                          'estimatedCost' => round(count($msisdns) * $parts * SMS_PRICE_DKK, 2)]);
        exit;
    }
    send_and_log($msisdns, $text, $parts, $scope, 'Manuel', $callerUid, $callerName, $projectId, $fsToken, $sa);
    exit;
}

// ── Hent Conventus API-nøgle ───────────────────────────────────────────────────
$conventusKey = getenv('CONVENTUS_KEY') ?: '';
if (!$conventusKey) {
    foreach ([__DIR__ . '/.env', __DIR__ . '/../../.env'] as $p) {
        if (file_exists($p)) { $e = parse_ini_file($p); if (!empty($e['CONVENTUS_KEY'])) { $conventusKey = $e['CONVENTUS_KEY']; break; } }
    }
}
if (!$conventusKey) { http_response_code(500); echo json_encode(['error' => 'CONVENTUS_KEY ikke konfigureret']); exit; }

// ── Target-gruppe-IDs sendes færdigberegnede fra frontend ─────────────────────
// scope='all'    → hold_ids=[] (tom = alle)
// scope='gruppe' → hold_ids=[conventus_id, ...] (beregnet i Admin.jsx)
$rawIds         = (array)($input['hold_ids'] ?? []);
$targetGroupIds = array_values(array_unique(array_filter(array_map('intval', $rawIds))));

// ── Hent telefonnumre fra Conventus ───────────────────────────────────────────
$msisdns = fetch_conventus_msisdns($conventusKey, $targetGroupIds);

if ($action === 'preview') {
    echo json_encode(['ok' => true, 'count' => count($msisdns), 'parts' => $parts,
                      'estimatedCost' => round(count($msisdns) * $parts * SMS_PRICE_DKK, 2)]);
    exit;
}

send_and_log($msisdns, $text, $parts, $scope, $scopeLabel, $callerUid, $callerName, $projectId, $fsToken, $sa);

// ═══════════════════════════════════════════════════════════════════════════════

// ── SMS-hjælpere ──────────────────────────────────────────────────────────────

function sms_parts(string $text): int {
    $len = mb_strlen($text);
    if ($len <= 160) return 1;
    if ($len <= 306) return 2;
    return (int)ceil($len / 153);
}

function parse_manual_numbers(string $input): array {
    $msisdns = [];
    foreach (preg_split('/[\s,;]+/', $input) as $raw) {
        $msisdn = to_msisdn($raw, '45');
        if ($msisdn) $msisdns[] = $msisdn;
    }
    return array_values(array_unique($msisdns));
}

function to_msisdn(string $number, string $dialCode = '45'): ?int {
    $number   = preg_replace('/\D/', '', $number);
    $dialCode = preg_replace('/\D/', '', $dialCode) ?: '45';
    if (!$number) return null;
    // Fjern landekode hvis nummeret allerede har den
    if (strpos($number, $dialCode) === 0 && strlen($number) > 8) {
        $number = substr($number, strlen($dialCode));
    }
    $number = ltrim($number, '0');
    if (!$number) return null;
    $msisdn = (int)($dialCode . $number);
    $len = strlen((string)$msisdn);
    if ($len < 7 || $len > 15) return null;
    return $msisdn;
}

// ── Hent MSISDNs fra Conventus ────────────────────────────────────────────────
function fetch_conventus_msisdns(string $apiKey, array $targetGroupIds): array {
    $ctx = stream_context_create(['http' => ['timeout' => 90, 'ignore_errors' => true]]);
    $url = 'https://www.conventus.dk/dataudv/api/adressebog/get_membres.php?' . http_build_query([
        'forening'   => '1031',
        'key'        => $apiKey,
        'relationer' => 'true',
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if (!$raw) return [];

    if (preg_match('/encoding=["\']ISO-8859-1["\']/i', $raw)) {
        $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
        $raw = preg_replace('/encoding=["\']ISO-8859-1["\']/i', 'encoding="UTF-8"', $raw);
    }
    if (strpos(ltrim($raw), '<') !== 0) return [];

    return parse_msisdns_from_xml($raw, $targetGroupIds);
}

function parse_msisdns_from_xml(string $raw, array $targetGroupIds): array {
    $targetSet = array_flip($targetGroupIds); // O(1) lookup
    $filterByGroup = !empty($targetGroupIds);
    libxml_use_internal_errors(true);
    $reader = new XMLReader();
    if (!$reader->XML($raw, 'UTF-8', LIBXML_NOERROR | LIBXML_NOWARNING)) return [];

    $seen = [];

    while ($reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT) continue;
        if (strtolower($reader->localName) !== 'membre') continue;
        if ($reader->depth !== 2) continue;

        $xml = $reader->readOuterXml();
        $reader->next();
        if (!$xml) continue;

        $k = @simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NOERROR | LIBXML_NOWARNING);
        if (!$k) continue;

        // Tjek slettede
        if (strtolower(trim((string)($k->slettet ?? ''))) === 'true') continue;

        // Scope-filtrering: tjek om personen tilhører en af målgrupperne
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
            if (!$inGroup) continue;
        }

        // Hent mobil → fallback til tlf
        $mobil     = trim((string)($k->mobil     ?? ''));
        $mobilCode = trim((string)($k->mobil_dialCode ?? '45'));
        $tlf       = trim((string)($k->tlf       ?? ''));
        $tlfCode   = trim((string)($k->tlf_dialCode   ?? '45'));

        $msisdn = $mobil ? to_msisdn($mobil, $mobilCode) : null;
        if (!$msisdn && $tlf) $msisdn = to_msisdn($tlf, $tlfCode);
        if (!$msisdn) continue;

        // off_mobil=false → privat nummer, spring over
        if ($mobil && strtolower(trim((string)($k->off_mobil ?? 'true'))) === 'false') continue;

        $seen[$msisdn] = true;
        unset($k);
    }
    $reader->close();
    libxml_clear_errors();
    return array_keys($seen);
}

// ── GatewayAPI + Firestore-log ────────────────────────────────────────────────
function send_and_log(array $msisdns, string $text, int $parts, string $scope, string $scopeLabel,
                      string $uid, string $name, string $projectId, string $fsToken, array $sa): void {
    if (empty($msisdns)) {
        echo json_encode(['ok' => true, 'sent' => 0, 'message' => 'Ingen modtagere fundet']);
        return;
    }

    $smsKey = getenv('SMS_API_KEY') ?: '';
    if (!$smsKey) {
        http_response_code(503);
        echo json_encode(['error' => 'SMS_API_KEY er ikke konfigureret — se README for opsætning af GatewayAPI']);
        return;
    }

    // GatewayAPI REST-kald
    $recipients = array_map(function($m) { return ['msisdn' => $m]; }, $msisdns);
    $payload    = json_encode(['sender' => 'SSIF', 'message' => $text, 'recipients' => $recipients]);

    $gwResp = @file_get_contents('https://gatewayapi.com/rest/mtsms', false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Token {$smsKey}\r\nContent-Type: application/json\r\n",
        'content'       => $payload,
        'timeout'       => 30,
        'ignore_errors' => true,
    ]]));

    $gwData   = json_decode($gwResp ?: '{}', true);
    $gwOk     = isset($gwData['ids']) && !isset($gwData['code']);
    $gwIds    = $gwData['ids'] ?? [];
    $actualCost = $gwData['usage']['total_cost'] ?? null;
    $currency   = $gwData['usage']['currency']   ?? 'EUR';

    // Firestore-log: ingen persondata
    $logDoc = [
        'sentAt'        => ['timestampValue' => gmdate('Y-m-d\TH:i:s\Z')],
        'senderUid'     => ['stringValue'    => $uid],
        'senderName'    => ['stringValue'    => $name],
        'scope'         => ['stringValue'    => $scope . ($scope !== 'manual' && $scope !== 'all' ? ":{$scopeLabel}" : '')],
        'recipients'    => ['integerValue'   => (string)count($msisdns)],
        'parts'         => ['integerValue'   => (string)$parts],
        'text'          => ['stringValue'    => $text],
        'gatewayOk'     => ['booleanValue'   => $gwOk],
        'gatewayIds'    => ['arrayValue'     => ['values' => array_map(function($id) { return ['integerValue' => (string)$id]; }, $gwIds)]],
        'estimatedCost' => ['doubleValue'    => round(count($msisdns) * $parts * SMS_PRICE_DKK, 2)],
    ];
    if ($actualCost !== null) $logDoc['actualCost'] = ['doubleValue' => (float)$actualCost];
    if ($currency)            $logDoc['currency']   = ['stringValue' => $currency];

    @file_get_contents(
        "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/sms_logs",
        false, stream_context_create(['http' => [
            'method'        => 'POST',
            'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
            'content'       => json_encode(['fields' => $logDoc]),
            'timeout'       => 10,
            'ignore_errors' => true,
        ]])
    );

    if (!$gwOk) {
        http_response_code(502);
        echo json_encode(['error' => 'GatewayAPI fejlede', 'detail' => $gwData['message'] ?? ($gwData['code'] ?? 'Ukendt fejl')]);
        return;
    }

    $costStr = $actualCost !== null ? round($actualCost * 7.46, 2) . ' kr.' : round(count($msisdns) * $parts * SMS_PRICE_DKK, 2) . ' kr. (estimat)';
    echo json_encode(['ok' => true, 'sent' => count($msisdns), 'cost' => $costStr]);
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────
function make_access_token(array $sa, string $scope): string {
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
