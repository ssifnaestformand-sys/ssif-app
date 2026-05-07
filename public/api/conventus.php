<?php
/**
 * Conventus API Proxy
 *
 * Endpoints (via ?endpoint=...):
 *   grupper   → get_grupper.php  – aktive hold
 *   (default) → get_medlemmer.php
 *
 * CONVENTUS_KEY læses fra:
 *   1. Apache SetEnv (sat af deploy-pipeline via .htaccess)
 *   2. .env-fil ved siden af denne fil (fallback)
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Cache-Control: public, max-age=1800');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Hent API-nøgle ────────────────────────────────────────────────────────────
$apiKey = getenv('CONVENTUS_KEY');

if (!$apiKey) {
    foreach ([__DIR__ . '/.env', __DIR__ . '/../../.env'] as $envPath) {
        if (file_exists($envPath)) {
            $env = parse_ini_file($envPath);
            if (!empty($env['CONVENTUS_KEY'])) {
                $apiKey = $env['CONVENTUS_KEY'];
                break;
            }
        }
    }
}

if (!$apiKey) {
    http_response_code(500);
    echo json_encode(['error' => 'CONVENTUS_KEY ikke konfigureret på serveren']);
    exit;
}

// ── Routing ───────────────────────────────────────────────────────────────────
$endpoint = strtolower(trim($_GET['endpoint'] ?? ''));
$ctx      = stream_context_create(['http' => ['timeout' => 10]]);

if ($endpoint === 'grupper') {
    $url = 'https://www.conventus.dk/dataudv/api/adressebog/get_grupper.php?' . http_build_query([
        'forening'           => '1031',
        'key'                => $apiKey,
        'type'               => 'hold',
        'aktiv'              => 'true',
        'online_tilmelding'  => 'true',
    ]);

    $raw = @file_get_contents($url, false, $ctx);

    if ($raw === false) {
        http_response_code(503);
        echo json_encode(['error' => 'Ingen forbindelse til Conventus']);
        exit;
    }

    $xml = @simplexml_load_string($raw);

    if ($xml === false) {
        // Svaret er ikke XML (uventet format)
        http_response_code(502);
        echo json_encode(['error' => 'Uventet svar fra Conventus', 'raw' => substr($raw, 0, 500)]);
        exit;
    }

    // Tjek for fejl fra Conventus
    if (!empty((string)$xml->error)) {
        http_response_code(401);
        echo json_encode(['error' => (string)$xml->error]);
        exit;
    }

    // Konvertér XML → PHP-array og udtruk grupper
    $arr    = xmlToArray($xml);
    $groups = extractGroups($arr);

    echo json_encode([
        'groups'  => $groups,
        'count'   => count($groups),
        'fetched' => date('c'),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Standard: get_medlemmer ───────────────────────────────────────────────────
$url = 'https://www.conventus.dk/dataudv/api/adressebog/get_medlemmer.php?' . http_build_query([
    'forening'   => '1031',
    'key'        => $apiKey,
    'relationer' => 'true',
]);

$response = @file_get_contents($url, false, $ctx);
if ($response === false) {
    http_response_code(503);
    echo json_encode(['error' => 'Ingen forbindelse til Conventus']);
    exit;
}

echo $response;

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

/**
 * SimpleXML → ren PHP-array.
 * Attributter gemmes under '@attributes'.
 */
function xmlToArray(SimpleXMLElement $node): array {
    $result = [];

    // Attributter
    $attrs = (array) $node->attributes();
    if (!empty($attrs['@attributes'])) {
        $result['@attributes'] = $attrs['@attributes'];
    }

    // Child-elementer
    foreach ($node->children() as $tag => $child) {
        $childArr = xmlToArray($child);
        if (isset($result[$tag])) {
            if (!is_array($result[$tag]) || !isset($result[$tag][0])) {
                $result[$tag] = [$result[$tag]];
            }
            $result[$tag][] = $childArr;
        } else {
            $result[$tag] = $childArr;
        }
    }

    // Tekstindhold (leaf-node)
    if (empty($result)) {
        return trim((string) $node);
    }

    return $result;
}

/**
 * Rekursivt udtruk alle <gruppe>-elementer fra det konverterede array.
 * Understøtter både attribut-baseret og element-baseret XML.
 * Deduplicerer på gruppe-ID.
 */
function extractGroups(array|string $node, array &$seen = []): array {
    if (is_string($node)) return [];

    $result = [];

    // Hvis dette node ER en gruppe (har id + navn)
    if (isGruppeNode($node)) {
        $id   = getField($node, 'id');
        $navn = getField($node, 'navn');
        if ($id && $navn && !isset($seen[$id])) {
            $seen[$id] = true;
            $result[]  = [
                'id'   => (int) $id,
                'navn' => html_entity_decode($navn, ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
            ];
        }
    }

    // Rekursivt ned i child-elementer
    foreach ($node as $key => $child) {
        if ($key === '@attributes') continue;
        if (is_array($child)) {
            // Kan være en liste eller et enkelt sub-element
            if (isset($child[0])) {
                // Numerisk array – liste af elementer
                foreach ($child as $item) {
                    foreach (extractGroups($item, $seen) as $g) {
                        $result[] = $g;
                    }
                }
            } else {
                foreach (extractGroups($child, $seen) as $g) {
                    $result[] = $g;
                }
            }
        }
    }

    return $result;
}

/** Tjekker om et array-node repræsenterer en gruppe med id+navn */
function isGruppeNode(array $node): bool {
    return !empty(getField($node, 'id')) && !empty(getField($node, 'navn'));
}

/** Henter en feltværdi fra enten @attributes eller direkte nøgle */
function getField(array $node, string $key): string {
    if (isset($node['@attributes'][$key])) {
        return (string) $node['@attributes'][$key];
    }
    if (isset($node[$key]) && is_string($node[$key])) {
        return $node[$key];
    }
    if (isset($node[$key]['@attributes'])) {
        return (string) ($node[$key] ?? '');
    }
    return '';
}
