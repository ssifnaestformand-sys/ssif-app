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

// ── 2. Hent hold + udvalg for alle afdelinger + globalt opsamlingskald ────────
//
// Strategi for at sikre at ALLE grupper fra Conventus er i Firestore:
//   a) Per afdeling → type=hold og type=udvalg → giver afdeling_id
//   b) Globalt kald (ingen afdeling) → type=hold og type=udvalg
//      → opsamler grupper der ikke er tilknyttet en afdeling
//
// Deduplicering via $seen[conventus_id] = true sikrer ingen dobbeltskrivning.
// PATCH med updateMask bevarer admin-felter (aktiv, traener_uid, traeningstider).

$allHolds  = [];
$seen      = [];
$now       = date('c');
$debugAfd  = [];   // per-afdeling debug: [afd_id => [type => [found, error]]]
$debugGlob = [];   // globale kald debug

foreach ($afdelinger as $afdId => $afdNavn) {
    $debugAfd[$afdId] = ['navn' => $afdNavn, 'hold' => null, 'udvalg' => null];
    foreach (['hold', 'udvalg'] as $type) {
        $url = BASE_URL . 'get_grupper.php?' . http_build_query([
            'forening' => FORENING, 'key' => $apiKey,
            'type'     => $type,    'afdeling' => $afdId,
        ]);
        $raw = @file_get_contents($url, false, $ctx);

        if (!$raw) {
            $debugAfd[$afdId][$type] = ['error' => 'ingen svar', 'found' => 0];
            continue;
        }
        $raw = fix_encoding($raw);

        // Gem rå XML-preview for 37870 til diagnose
        $rawPreview = ($afdId === '37870')
            ? substr($raw, 0, 500)
            : null;

        $xml = @simplexml_load_string($raw);
        if (!$xml) {
            $debugAfd[$afdId][$type] = [
                'error'      => 'xml-parse-fejl',
                'raw_bytes'  => strlen($raw),
                'raw_start'  => substr($raw, 0, 120),
                'found'      => 0,
            ];
            continue;
        }

        // Tjek om Conventus returnerede en fejl i XML
        $xmlError = trim((string)($xml->error ?? ''));
        if ($xmlError) {
            $debugAfd[$afdId][$type] = ['error' => $xmlError, 'found' => 0];
            continue;
        }

        $extracted = extract_holds($xml);
        $added     = 0;
        foreach ($extracted as $h) {
            $id = (int)$h['conventus_id'];
            if (!$id || isset($seen[$id])) continue;
            $seen[$id]  = true;
            $allHolds[] = array_merge($h, ['afdeling_id' => $afdId, 'hold_type' => $type]);
            $added++;
        }

        $entry = [
            'found'     => count($extracted),
            'added_new' => $added,
            'raw_bytes' => strlen($raw),
        ];
        if ($rawPreview !== null) $entry['raw_preview'] = $rawPreview;
        $debugAfd[$afdId][$type] = $entry;
    }
}

// Globalt kald — fanger grupper der ikke er registreret under en afdeling
foreach (['hold', 'udvalg'] as $type) {
    $raw = @file_get_contents(
        BASE_URL . 'get_grupper.php?' . http_build_query([
            'forening' => FORENING, 'key' => $apiKey,
            'type'     => $type,
        ]),
        false, $ctx
    );
    if (!$raw) { $debugGlob[$type] = ['error' => 'ingen svar']; continue; }
    $raw = fix_encoding($raw);
    $xml = @simplexml_load_string($raw);
    if (!$xml) { $debugGlob[$type] = ['error' => 'xml-parse-fejl', 'raw_bytes' => strlen($raw)]; continue; }

    $extracted = extract_holds($xml);
    $added     = 0;
    foreach ($extracted as $h) {
        $id = (int)$h['conventus_id'];
        if (!$id || isset($seen[$id])) continue;
        $seen[$id]  = true;
        $allHolds[] = array_merge($h, ['afdeling_id' => '', 'hold_type' => $type]);
        $added++;
    }
    $debugGlob[$type] = ['found' => count($extracted), 'added_new' => $added];
}

// ── 3. Skriv afdelinger + hold individuelt med PATCH ─────────────────────────
$base        = "projects/{$projectId}/databases/(default)/documents";
$holdsWritten = 0;

// Afdelinger
foreach ($afdelinger as $afdId => $afdNavn) {
    fs_patch($token, "{$base}/afdelinger/{$afdId}", [
        'id'           => to_fs($afdId),
        'navn'         => to_fs($afdNavn),
        'sidst_hentet' => to_fs($now),
    ]);
    usleep(50000);
}

// Hold/udvalg — updateMask bevarer admin-felter (aktiv, traener_uid, traeningstider)
$holdKeys = ['conventus_id','titel','aktivitet_titel','periode_fra','periode_til','beskrivelse','afdeling_id','hold_type','sidst_synkroniseret'];
foreach ($allHolds as $h) {
    $docId    = (string)$h['conventus_id'];
    $fsFields = [];
    foreach ($holdKeys as $k) {
        $fsFields[$k] = to_fs($k === 'sidst_synkroniseret' ? $now : ($h[$k] ?? ''));
    }
    $mask = implode('&', array_map(fn($k) => 'updateMask.fieldPaths=' . urlencode($k), $holdKeys));
    $ok   = fs_patch($token, "{$base}/holds/{$docId}?{$mask}", $fsFields);
    if ($ok) $holdsWritten++;
    usleep(50000); // 50ms pause → ~23s for 460 hold
}

// Tæl fejl (logges ikke i svar — undgår informationslæk, fix M-3)
$afdErrors = 0;
foreach ($debugAfd as $info) {
    foreach (['hold', 'udvalg'] as $type) {
        if (isset(($info[$type] ?? [])['error'])) $afdErrors++;
    }
}

echo json_encode([
    'ok'            => true,
    'afdelinger'    => count($afdelinger),
    'holds_total'   => count($allHolds),
    'holds_written' => $holdsWritten,
    'afd_errors'    => $afdErrors,
    'synced'        => $now,
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

// fs_patch: PATCH til Firestore-dokument, returnerer true ved succes
// $url er fuld resource-path inkl. evt. ?updateMask.fieldPaths=...
// $fields er allerede konverteret til Firestore-format via to_fs()
function fs_patch(string $token, string $url, array $fields): bool {
    $resp = @file_get_contents(
        "https://firestore.googleapis.com/v1/{$url}",
        false, stream_context_create(['http' => [
            'method'        => 'PATCH',
            'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
            'content'       => json_encode(['fields' => $fields]),
            'timeout'       => 10,
            'ignore_errors' => true,
        ]])
    );
    return $resp !== false && isset(json_decode($resp, true)['name']);
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
