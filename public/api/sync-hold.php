<?php
/**
 * Synkronisér ét enkelt hold fra Conventus til Firestore.
 *
 * POST  Authorization: Bearer <Firebase ID-token (admin)>
 *       Content-Type: application/json
 *       { "conventus_id": 999024 }
 *
 * Strategi:
 *   1. Læs holdet fra Firestore → find afdeling_id + hold_type
 *   2. Kald Conventus get_grupper.php for den afdeling (begge typer som fallback)
 *   3. Find holdet via conventus_id og skriv til Firestore med updateMask
 *      (bevarer admin-felter: aktiv, traener_uid, traeningstider)
 *   4. Returnér de opdaterede felter
 */

require_once __DIR__ . '/_auth.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
$idToken = bearer_token();
if (!$idToken) { http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit; }

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) { http_response_code(500); echo json_encode(['error' => 'Service account mangler']); exit; }
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'] ?? '';

if (!$projectId || !verify_firebase_id_token($idToken, $projectId)) {
    http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit;
}
$fsToken = make_fs_token($sa);
require_role(uid_from_token($idToken), $projectId, $fsToken, ['admin']);

// ── Conventus API-nøgle ───────────────────────────────────────────────────────
$apiKey = getenv('CONVENTUS_KEY') ?: '';
if (!$apiKey) { http_response_code(500); echo json_encode(['error' => 'CONVENTUS_KEY mangler']); exit; }

// ── Læs conventus_id fra request-body ────────────────────────────────────────
$body        = json_decode(file_get_contents('php://input'), true) ?: [];
$conventusId = (int)($body['conventus_id'] ?? $_POST['conventus_id'] ?? 0);
if ($conventusId <= 0) { http_response_code(400); echo json_encode(['error' => 'conventus_id mangler eller ugyldig']); exit; }

// ── 1. Hent holdet fra Firestore (for afdeling_id + hold_type) ───────────────
// $docBase bruges af fs_patch_doc (som selv prepender https://firestore.googleapis.com/v1/)
// $fsBase  bruges af fs_get (som bruger URL'en direkte via file_get_contents)
$docBase = "projects/{$projectId}/databases/(default)/documents";
$fsBase  = "https://firestore.googleapis.com/v1/{$docBase}";

$holdDoc = fs_get("{$fsBase}/holds/{$conventusId}", $fsToken);
if (!$holdDoc) { http_response_code(404); echo json_encode(['error' => "Hold {$conventusId} ikke fundet i Firestore"]); exit; }

$f           = $holdDoc['fields'] ?? [];
$afdeling_id = $f['afdeling_id']['stringValue'] ?? '';
$hold_type   = $f['hold_type']['stringValue']    ?: 'hold';

// ── 2. Søg holdet i Conventus ─────────────────────────────────────────────────
// Søgestrategi: prøv afdeling+type, så afdeling+anden-type, så globalt – stop ved fund.
const FORENING = '1031';
const BASE_URL = 'https://www.conventus.dk/dataudv/api/adressebog/';
$ctx = stream_context_create(['http' => ['timeout' => 20, 'ignore_errors' => true]]);

$searches = [];
if ($afdeling_id) {
    $searches[] = ['type' => $hold_type,                                    'afdeling' => $afdeling_id];
    $searches[] = ['type' => ($hold_type === 'hold' ? 'udvalg' : 'hold'),   'afdeling' => $afdeling_id];
}
$searches[] = ['type' => $hold_type,                                   'afdeling' => null];
$searches[] = ['type' => ($hold_type === 'hold' ? 'udvalg' : 'hold'),  'afdeling' => null];

$found    = null;
$foundAfd = $afdeling_id;
$foundType = $hold_type;

foreach ($searches as $s) {
    $params = ['forening' => FORENING, 'key' => $apiKey, 'type' => $s['type']];
    if ($s['afdeling']) $params['afdeling'] = $s['afdeling'];

    $raw = @file_get_contents(BASE_URL . 'get_grupper.php?' . http_build_query($params), false, $ctx);
    if (!$raw) continue;

    if (preg_match('/encoding=["\']ISO-8859-1["\']/i', $raw)) {
        $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
        $raw = preg_replace('/encoding=["\']ISO-8859-1["\']/i', 'encoding="UTF-8"', $raw);
    }
    $xml = @simplexml_load_string($raw);
    if (!$xml) continue;

    foreach (extract_holds_from_xml($xml) as $h) {
        if ((int)$h['conventus_id'] === $conventusId) {
            $found     = $h;
            $foundAfd  = $s['afdeling'] ?: $afdeling_id;
            $foundType = $s['type'];
            break 2;
        }
    }
}

if (!$found) {
    http_response_code(404);
    echo json_encode(['error' => "Hold {$conventusId} ikke fundet i Conventus"]);
    exit;
}

// ── 3. Skriv til Firestore med updateMask (bevarer aktiv, traener_uid, traeningstider) ──
$now      = date('c');
$holdKeys = ['conventus_id','titel','aktivitet_titel','periode_fra','periode_til',
             'beskrivelse','afdeling_id','hold_type','sidst_synkroniseret'];
$fsFields = [];
$data     = array_merge($found, ['afdeling_id' => $foundAfd, 'hold_type' => $foundType]);
foreach ($holdKeys as $k) {
    $fsFields[$k] = to_fs_val($k === 'sidst_synkroniseret' ? $now : ($data[$k] ?? ''));
}
$mask    = implode('&', array_map(fn($k) => 'updateMask.fieldPaths=' . urlencode($k), $holdKeys));
$docPath = "{$docBase}/holds/{$conventusId}?{$mask}";
$ok      = fs_patch_doc($fsToken, $docPath, $fsFields);

if (!$ok) {
    http_response_code(500);
    echo json_encode(['error' => 'Firestore-skrivning fejlede']);
    exit;
}

// ── 4. Returnér de opdaterede felter ─────────────────────────────────────────
echo json_encode([
    'ok'   => true,
    'hold' => [
        'titel'               => $found['titel'],
        'aktivitet_titel'     => $found['aktivitet_titel'],
        'periode_fra'         => $found['periode_fra'],
        'periode_til'         => $found['periode_til'],
        'beskrivelse'         => $found['beskrivelse'],
        'afdeling_id'         => $foundAfd,
        'hold_type'           => $foundType,
        'sidst_synkroniseret' => $now,
    ],
    'synced' => $now,
], JSON_UNESCAPED_UNICODE);

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

function fs_patch_doc(string $token, string $path, array $fields): bool {
    $resp = @file_get_contents(
        "https://firestore.googleapis.com/v1/{$path}",
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

function to_fs_val($v): array {
    if (is_null($v))   return ['nullValue'    => 'NULL_VALUE'];
    if (is_bool($v))   return ['booleanValue' => $v];
    if (is_int($v))    return ['integerValue' => (string)$v];
    if (is_string($v)) return ['stringValue'  => $v];
    return ['stringValue' => (string)$v];
}

function extract_holds_from_xml(SimpleXMLElement $xml): array {
    $arr  = xml_node_to_array($xml);
    $seen = [];
    return extract_holds_recursive($arr, $seen);
}

function extract_holds_recursive($node, array &$seen): array {
    if (!is_array($node)) return [];
    $result = [];
    $id     = xml_get_field($node, 'id');
    if ($id && !isset($seen[$id])) {
        $titel = xml_get_field($node, 'titel', 'navn', 'name');
        if ($titel) {
            $seen[$id] = true;
            $result[]  = [
                'conventus_id'    => (int)$id,
                'titel'           => html_entity_decode($titel, ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
                'aktivitet_titel' => html_entity_decode(xml_get_field($node, 'aktivitet_titel', 'aktivitet'), ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
                'periode_fra'     => xml_get_field($node, 'periode_fra', 'periodeStart', 'start'),
                'periode_til'     => xml_get_field($node, 'periode_til', 'periodeslut', 'slut'),
                'beskrivelse'     => html_entity_decode(xml_get_field($node, 'om_holdet', 'beskrivelse', 'omholdet'), ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
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

function xml_node_to_array(SimpleXMLElement $node): array {
    $result = [];
    $attrs  = (array)$node->attributes();
    if (!empty($attrs['@attributes'])) $result['@attributes'] = $attrs['@attributes'];
    foreach ($node->children() as $tag => $child) {
        $val = xml_node_to_array($child);
        if (isset($result[$tag])) {
            if (!is_array($result[$tag]) || !array_key_exists(0, $result[$tag])) $result[$tag] = [$result[$tag]];
            $result[$tag][] = $val;
        } else {
            $result[$tag] = $val;
        }
    }
    return empty($result) ? trim((string)$node) : $result;
}

function xml_get_field($node, string ...$keys): string {
    if (!is_array($node)) return '';
    foreach ($keys as $key) {
        if (isset($node['@attributes'][$key]) && $node['@attributes'][$key] !== '') return (string)$node['@attributes'][$key];
        if (isset($node[$key]) && is_string($node[$key]) && $node[$key] !== '')     return $node[$key];
    }
    return '';
}
