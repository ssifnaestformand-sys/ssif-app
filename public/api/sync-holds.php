<?php
/**
 * Synkronisér afdelinger og hold fra Conventus til Firestore.
 *
 * POST med header X-Sync-Secret: <SYNC_SECRET>
 *
 * 1. Henter alle afdelinger via get_afdelinger.php
 * 2. Henter hold for hver afdeling via get_grupper.php?afdeling=ID
 * 3. Skriver til Firestore:
 *    - afdelinger/{id}  → { navn, sidst_hentet }
 *    - holds/{conventus_id} → { titel, aktivitet_titel, ... }
 *    Admin-felterne (aktiv, traener_uid, traeningstider) bevares.
 */

ini_set('display_errors', '1');
error_reporting(E_ALL);
set_time_limit(300);
ignore_user_abort(true);
ini_set('memory_limit', '128M');

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: X-Sync-Secret');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); exit; }

// ── Auth ──────────────────────────────────────────────────────────────────────
$secret = getenv('SYNC_SECRET') ?: '';
$sent   = $_SERVER['HTTP_X_SYNC_SECRET'] ?? '';
if (!$secret || !hash_equals($secret, $sent)) {
    http_response_code(401);
    echo json_encode(['error' => 'Uautoriseret']);
    exit;
}

// ── Conventus API-nøgle ───────────────────────────────────────────────────────
$apiKey = getenv('CONVENTUS_KEY') ?: '';
if (!$apiKey) {
    foreach ([__DIR__ . '/.env', __DIR__ . '/../../.env'] as $p) {
        if (file_exists($p)) {
            $env = parse_ini_file($p);
            if (!empty($env['CONVENTUS_KEY'])) { $apiKey = $env['CONVENTUS_KEY']; break; }
        }
    }
}
if (!$apiKey) {
    http_response_code(500);
    echo json_encode(['error' => 'CONVENTUS_KEY ikke konfigureret']);
    exit;
}

// ── Firebase service account ──────────────────────────────────────────────────
$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'Firebase service account mangler']);
    exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];
$token     = google_access_token($sa);
if (!$token) {
    http_response_code(500);
    echo json_encode(['error' => 'Firebase auth fejlede']);
    exit;
}

const FORENING  = '1031';
const BASE_URL  = 'https://www.conventus.dk/dataudv/api/adressebog/';
$ctx = stream_context_create(['http' => ['timeout' => 20, 'ignore_errors' => true]]);

// ── 1. Hent alle afdelinger ───────────────────────────────────────────────────
$afdRaw = @file_get_contents(
    BASE_URL . 'get_afdelinger.php?' . http_build_query(['forening' => FORENING, 'key' => $apiKey]),
    false, $ctx
);
if (!$afdRaw) {
    http_response_code(503);
    echo json_encode(['error' => 'Ingen svar fra Conventus (afdelinger)']);
    exit;
}
$afdRaw = fix_encoding($afdRaw);
$afdXml = @simplexml_load_string($afdRaw);
if (!$afdXml) {
    http_response_code(502);
    echo json_encode(['error' => 'XML-fejl fra Conventus (afdelinger)']);
    exit;
}

// XML-struktur: <conventus><afdelinger><afdeling><id>...</id><titel>...</titel>
$afdelinger  = [];
$xpathNodes  = $afdXml->xpath('//afdelinger/afdeling') ?: [];
$debugXpath  = count($xpathNodes);
$debugRawLen = strlen($afdRaw);

foreach ($xpathNodes as $node) {
    $id    = trim((string)$node->id);
    $titel = trim((string)($node->titel ?: $node->navn ?: $node->name ?: ''));
    if ($id && ctype_digit($id) && !isset($afdelinger[$id])) {
        $afdelinger[$id] = html_entity_decode($titel, ENT_HTML5 | ENT_QUOTES, 'UTF-8');
    }
}
if (!$afdelinger) {
    echo json_encode([
        'ok'          => true,
        'afdelinger'  => 0,
        'holds_written' => 0,
        'note'        => 'Ingen afdelinger fundet',
        'debug'       => [
            'raw_bytes'   => $debugRawLen,
            'xpath_nodes' => $debugXpath,
            'raw_preview' => substr($afdRaw, 0, 300),
        ],
    ]);
    exit;
}

// ── 2. Hent hold for alle afdelinger ─────────────────────────────────────────
$allHolds = [];
$now      = date('c');

foreach ($afdelinger as $afdId => $afdNavn) {
    $holdRaw = @file_get_contents(
        BASE_URL . 'get_grupper.php?' . http_build_query([
            'forening' => FORENING, 'key' => $apiKey,
            'type' => 'hold', 'aktiv' => 'true', 'afdeling' => $afdId,
        ]),
        false, $ctx
    );
    if (!$holdRaw) continue;
    $holdRaw = fix_encoding($holdRaw);
    $holdXml = @simplexml_load_string($holdRaw);
    if (!$holdXml) continue;
    foreach (extract_holds($holdXml) as $h) {
        $allHolds[] = array_merge($h, ['afdeling_id' => $afdId]);
    }
}

// ── 3. Én samlet batch-commit: afdelinger + hold ──────────────────────────────
// 460 holds + 37 afdelinger = ~500 → passer i ét kald og undgår rate-limiting
// fra 37 individuelle PATCH-kald + multiple batch-commits.
$allWrites   = [];
$holdsWritten = 0;
$base        = "projects/{$projectId}/databases/(default)/documents";

foreach ($afdelinger as $afdId => $afdNavn) {
    $allWrites[] = [
        'update' => [
            'name'   => "{$base}/afdelinger/{$afdId}",
            'fields' => [
                'id'           => to_fs($afdId),
                'navn'         => to_fs($afdNavn),
                'sidst_hentet' => to_fs($now),
            ],
        ],
    ];
}

foreach ($allHolds as $h) {
    $docId    = (string)$h['conventus_id'];
    $holdKeys = ['conventus_id','titel','aktivitet_titel','periode_fra','periode_til','beskrivelse','afdeling_id','sidst_synkroniseret'];
    $fsFields = [];
    foreach ($holdKeys as $k) {
        $v = $k === 'sidst_synkroniseret' ? $now : ($h[$k] ?? '');
        $fsFields[$k] = to_fs($v);
    }
    $allWrites[] = [
        'update'     => ['name' => "{$base}/holds/{$docId}", 'fields' => $fsFields],
        'updateMask' => ['fieldPaths' => $holdKeys],
    ];
}

// batchWrite (ikke commit) — ikke-transaktionel, designet til bulk-skriv
// Chunk på 100 med 1s pause mellem kald for at undgå rate-limiting
$chunks = array_chunk($allWrites, 100);
foreach ($chunks as $i => $chunk) {
    $resp = @file_get_contents(
        "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:batchWrite",
        false, stream_context_create(['http' => [
            'method'        => 'POST',
            'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
            'content'       => json_encode(['writes' => $chunk]),
            'timeout'       => 60,
            'ignore_errors' => true,
        ]])
    );
    $data = json_decode($resp ?: '', true);
    if (isset($data['writeResults'])) {
        $holdsWritten += count($data['writeResults']);
    } else {
        if (!isset($debugCommitError)) $debugCommitError = substr($resp ?: 'tom svar', 0, 500);
    }
    if ($i < count($chunks) - 1) sleep(1); // 1s pause mellem kald
}

echo json_encode([
    'ok'            => true,
    'afdelinger'    => count($afdelinger),
    'holds_total'   => count($allHolds),
    'holds_written' => $holdsWritten,
    'synced'        => $now,
    'debug'         => [
        'raw_bytes'     => $debugRawLen,
        'xpath_nodes'   => $debugXpath,
        'afd_sample'    => array_slice(array_values($afdelinger), 0, 3),
        'commit_error'  => $debugCommitError ?? null,
        'token_ok'      => !empty($token),
        'project_id'    => $projectId,
    ],
], JSON_UNESCAPED_UNICODE);

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

function xml_to_array(SimpleXMLElement $node) {
    $result = [];
    $attrs  = (array)$node->attributes();
    if (!empty($attrs['@attributes'])) $result['@attributes'] = $attrs['@attributes'];
    foreach ($node->children() as $tag => $child) {
        $val = xml_to_array($child);
        if (isset($result[$tag])) {
            if (!is_array($result[$tag]) || !array_key_exists(0, $result[$tag])) $result[$tag] = [$result[$tag]];
            $result[$tag][] = $val;
        } else {
            $result[$tag] = $val;
        }
    }
    return empty($result) ? trim((string)$node) : $result;
}

function get_field($node, string ...$keys): string {
    if (!is_array($node)) return '';
    foreach ($keys as $key) {
        if (isset($node['@attributes'][$key]) && (string)$node['@attributes'][$key] !== '') return (string)$node['@attributes'][$key];
        if (isset($node[$key]) && is_string($node[$key]) && $node[$key] !== '')              return $node[$key];
    }
    return '';
}

function fix_encoding(string $raw): string {
    if (preg_match('/encoding=["\']ISO-8859-1["\']/i', $raw)) {
        $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
        $raw = preg_replace('/encoding=["\']ISO-8859-1["\']/i', 'encoding="UTF-8"', $raw);
    }
    return $raw;
}

// Samme parsing-logik som extractHolds() i conventus.php — håndterer
// både attributter og child-elementer, da Conventus bruger begge formater.
function extract_holds(SimpleXMLElement $xml): array {
    $arr  = xml_to_array($xml);
    $seen = [];
    return extract_holds_recursive($arr, $seen);
}

function extract_holds_recursive($node, array &$seen): array {
    if (!is_array($node)) return [];
    $result = [];
    $id     = get_field($node, 'id');
    if ($id && !isset($seen[$id])) {
        $titel          = get_field($node, 'titel', 'navn', 'name');
        $aktivitetTitel = get_field($node, 'aktivitet_titel', 'aktivitet');
        $periodeFra     = get_field($node, 'periode_fra', 'periodeStart', 'start');
        $periodeTil     = get_field($node, 'periode_til', 'periodeslut', 'slut');
        $beskrivelse    = get_field($node, 'om_holdet', 'beskrivelse', 'omholdet');
        if ($titel) {
            $seen[$id] = true;
            $result[]  = [
                'conventus_id'    => (int)$id,
                'titel'           => html_entity_decode($titel,          ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
                'aktivitet_titel' => html_entity_decode($aktivitetTitel, ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
                'periode_fra'     => $periodeFra,
                'periode_til'     => $periodeTil,
                'beskrivelse'     => html_entity_decode($beskrivelse,    ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
            ];
        }
    }
    foreach ($node as $key => $child) {
        if ($key === '@attributes') continue;
        $items = (is_array($child) && isset($child[0])) ? $child : [$child];
        foreach ($items as $item) {
            foreach (extract_holds_recursive($item, $seen) as $h) $result[] = $h;
        }
    }
    return $result;
}

function firestore_patch(string $projectId, string $token, string $path, array $data): void {
    $fields = [];
    foreach ($data as $k => $v) $fields[$k] = to_fs($v);
    @file_get_contents(
        "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/{$path}",
        false, stream_context_create(['http' => [
            'method'        => 'PATCH',
            'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
            'content'       => json_encode(['fields' => $fields]),
            'timeout'       => 10,
            'ignore_errors' => true,
        ]])
    );
}

function to_fs($v): array {
    if (is_null($v))   return ['nullValue'   => 'NULL_VALUE'];
    if (is_bool($v))   return ['booleanValue'=> $v];
    if (is_int($v))    return ['integerValue'=> (string)$v];
    if (is_string($v)) return ['stringValue' => $v];
    return ['stringValue' => (string)$v];
}

function google_access_token(array $sa): string {
    $now    = time();
    $header = b64u(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claims = b64u(json_encode([
        'iss' => $sa['client_email'], 'scope' => 'https://www.googleapis.com/auth/datastore',
        'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600,
    ]));
    $unsigned = "$header.$claims";
    openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$unsigned." . b64u($sig);
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false,
        stream_context_create(['http' => [
            'method'  => 'POST', 'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $jwt]),
            'timeout' => 10, 'ignore_errors' => true,
        ]])
    );
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}

function b64u(string $d): string {
    return rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
}
