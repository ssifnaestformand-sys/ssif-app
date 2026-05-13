<?php
/**
 * Conventus API Proxy
 *
 * Endpoints (?endpoint=...):
 *   sync     → Henter aktive hold fra ALLE afdelinger, returnerer normaliseret JSON
 *   grupper  → Rå hold-liste (brugt til dropdown i admin)
 *   (default) → get_medlemmer.php
 *
 * CONVENTUS_KEY læses fra Apache SetEnv (injiceret via deploy.yml) eller .env-fil.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── API-nøgle ────────────────────────────────────────────────────────────────
$apiKey = getenv('CONVENTUS_KEY');
if (!$apiKey) {
    foreach ([__DIR__ . '/.env', __DIR__ . '/../../.env'] as $path) {
        if (file_exists($path)) {
            $env = parse_ini_file($path);
            if (!empty($env['CONVENTUS_KEY'])) { $apiKey = $env['CONVENTUS_KEY']; break; }
        }
    }
}
if (!$apiKey) {
    http_response_code(500);
    echo json_encode(['error' => 'CONVENTUS_KEY ikke konfigureret på serveren']);
    exit;
}

$endpoint = strtolower(trim($_GET['endpoint'] ?? ''));
$ctx      = stream_context_create(['http' => ['timeout' => 15]]);

const BASE_URL  = 'https://www.conventus.dk/dataudv/api/adressebog/get_grupper.php';
const FORENING  = '1031';

// ── SYNC: hent alle aktive hold fra alle afdelinger ───────────────────────────
if ($endpoint === 'sync') {
    header('Cache-Control: no-cache');

    // Definér hvilke Conventus-kald der skal laves og hvilke filtre der anvendes
    $sources = [
        // Alle aktive fodboldhold (ingen afdelingsfilter – online_tilmelding allerede i URL)
        [
            'params'           => ['type' => 'hold', 'aktiv' => 'true', 'online_tilmelding' => 'true'],
            'aktivitet_filter' => null,   // ingen ekstra filtrering
        ],
        // Gymnastikafdeling
        [
            'params'           => ['type' => 'hold', 'aktiv' => 'true', 'afdeling' => '4001'],
            'aktivitet_filter' => 'Gymnastik',  // kun hold med aktivitet_titel = "Gymnastik"
        ],
    ];

    $allHolds = [];
    $seen     = [];
    $errors   = [];

    foreach ($sources as $source) {
        $url = BASE_URL . '?' . http_build_query(array_merge(
            ['forening' => FORENING, 'key' => $apiKey],
            $source['params']
        ));

        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) { $errors[] = "Timeout/fejl: {$url}"; continue; }

        $xml = @simplexml_load_string($raw);
        if ($xml === false)           { $errors[] = 'XML parse-fejl'; continue; }
        if (!empty((string)$xml->error)) { $errors[] = (string)$xml->error; continue; }

        $arr   = xmlToArray($xml);
        $holds = extractHolds($arr, $source['aktivitet_filter']);

        foreach ($holds as $h) {
            $id = (string)$h['conventus_id'];
            if (!isset($seen[$id])) {
                $seen[$id] = true;
                $allHolds[] = $h;
            }
        }
    }

    usort($allHolds, fn($a,$b) => strcmp($a['aktivitet_titel'], $b['aktivitet_titel']) ?: strcmp($a['titel'], $b['titel']));

    echo json_encode([
        'holds'   => $allHolds,
        'count'   => count($allHolds),
        'fetched' => date('c'),
        'errors'  => $errors,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── GRUPPER: simpel hold-liste til dropdown ───────────────────────────────────
if ($endpoint === 'grupper') {
    header('Cache-Control: public, max-age=1800');
    $url = BASE_URL . '?' . http_build_query([
        'forening'          => FORENING,
        'key'               => $apiKey,
        'type'              => 'hold',
        'aktiv'             => 'true',
        'online_tilmelding' => 'true',
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) { http_response_code(503); echo json_encode(['error' => 'Ingen svar fra Conventus']); exit; }
    $xml = @simplexml_load_string($raw);
    if ($xml === false || !empty((string)$xml->error)) { http_response_code(502); echo json_encode(['error' => $xml ? (string)$xml->error : 'XML-fejl']); exit; }
    $arr    = xmlToArray($xml);
    $groups = extractHolds($arr, null);
    echo json_encode(['groups' => $groups, 'count' => count($groups), 'fetched' => date('c')], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── STANDARD: get_medlemmer ───────────────────────────────────────────────────
$url = 'https://www.conventus.dk/dataudv/api/adressebog/get_medlemmer.php?' . http_build_query([
    'forening' => FORENING, 'key' => $apiKey, 'relationer' => 'true',
]);
$resp = @file_get_contents($url, false, $ctx);
if ($resp === false) { http_response_code(503); echo json_encode(['error' => 'Ingen svar fra Conventus']); exit; }
echo $resp;

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

/**
 * SimpleXML → PHP-array.
 * Attributter gemmes under '@attributes'.
 */
function xmlToArray(SimpleXMLElement $node): array {
    $result = [];
    $attrs  = (array)$node->attributes();
    if (!empty($attrs['@attributes'])) $result['@attributes'] = $attrs['@attributes'];
    foreach ($node->children() as $tag => $child) {
        $val = xmlToArray($child);
        if (isset($result[$tag])) {
            if (!is_array($result[$tag]) || !array_key_exists(0, $result[$tag])) $result[$tag] = [$result[$tag]];
            $result[$tag][] = $val;
        } else {
            $result[$tag] = $val;
        }
    }
    return $result ?: trim((string)$node);
}

/**
 * Udtruk feltværdi fra både attributter og child-elementer.
 * Prøver danske og engelske varianter af feltnavnet.
 */
function getField(array|string $node, string ...$keys): string {
    if (is_string($node)) return '';
    foreach ($keys as $key) {
        if (isset($node['@attributes'][$key]) && $node['@attributes'][$key] !== '') return (string)$node['@attributes'][$key];
        if (isset($node[$key]) && is_string($node[$key]) && $node[$key] !== '')       return $node[$key];
    }
    return '';
}

/**
 * Rekursivt udtruk alle gruppe-noder og normaliser til hold-objekter.
 * $aktivitetFilter: hvis sat, beholdes kun hold med matchende aktivitet_titel.
 */
function extractHolds(array|string $node, ?string $aktivitetFilter, array &$seen = []): array {
    if (is_string($node)) return [];
    $result = [];

    // Er dette node selv et hold?
    $id = getField($node, 'id');
    if ($id && !isset($seen[$id])) {
        $titel           = getField($node, 'titel', 'navn', 'name');
        $aktivitetTitel  = getField($node, 'aktivitet_titel', 'aktivitet');
        $periodeFra      = getField($node, 'periode_fra', 'periodeStart', 'start');
        $periodeTil      = getField($node, 'periode_til', 'periodesSlut', 'slut');
        $onlineTilm      = strtolower(getField($node, 'online_tilmelding', 'onlinetilmelding'));
        $beskrivelse     = getField($node, 'om_holdet', 'beskrivelse', 'omholdet');

        $onlineOk  = in_array($onlineTilm, ['1', 'true', 'yes', ''], true); // tom = ukendt, tillad

        // Anvend filter kun når vi kender aktiviteten
        $aktivitetOk = $aktivitetFilter === null
            || $aktivitetTitel === ''
            || stripos($aktivitetTitel, $aktivitetFilter) !== false;

        $periodeOk = $aktivitetFilter === null || $periodeFra !== '';

        if ($titel && $aktivitetOk && $onlineOk && $periodeOk) {
            $seen[$id] = true;
            $result[] = [
                'conventus_id'    => (int)$id,
                'titel'           => html_entity_decode($titel,        ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
                'aktivitet_titel' => html_entity_decode($aktivitetTitel, ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
                'periode_fra'     => $periodeFra,
                'periode_til'     => $periodeTil,
                'beskrivelse'     => html_entity_decode($beskrivelse,  ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
            ];
        }
    }

    // Rekursivt ned
    foreach ($node as $key => $child) {
        if ($key === '@attributes') continue;
        $items = (is_array($child) && isset($child[0])) ? $child : [$child];
        foreach ($items as $item) {
            if (is_array($item) || $item instanceof SimpleXMLElement) {
                foreach (extractHolds($item, $aktivitetFilter, $seen) as $h) {
                    $result[] = $h;
                }
            }
        }
    }
    return $result;
}
