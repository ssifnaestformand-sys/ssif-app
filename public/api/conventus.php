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

// ── SYNC: hent alle hold fra alle afdelinger (ingen filtrering) ──────────────
if ($endpoint === 'sync') {
    header('Cache-Control: no-cache');

    $url = BASE_URL . '?' . http_build_query([
        'forening' => FORENING,
        'key'      => $apiKey,
        'type'     => 'hold',
    ]);

    $allHolds = [];
    $seen     = [];
    $errors   = [];

    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) { $errors[] = 'Conventus svarede ikke (timeout)'; }
    else {
        $xml = @simplexml_load_string($raw);
        if ($xml === false)               { $errors[] = 'XML parse-fejl'; }
        elseif (!empty((string)$xml->error)) { $errors[] = (string)$xml->error; }
        else {
            foreach (extractHolds(xmlToArray($xml)) as $h) {
                $id = (string)$h['conventus_id'];
                if (!isset($seen[$id])) { $seen[$id] = true; $allHolds[] = $h; }
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

// ── AFDELINGER: hent alle afdelinger med ID og titel ─────────────────────────
if ($endpoint === 'afdelinger') {
    header('Cache-Control: public, max-age=3600');
    $url = 'https://www.conventus.dk/dataudv/api/adressebog/get_afdelinger.php?' . http_build_query([
        'forening' => FORENING,
        'key'      => $apiKey,
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) { echo json_encode(['error' => 'Ingen svar fra Conventus']); exit; }
    if (preg_match('/encoding=["\']ISO-8859-1["\']/i', $raw)) {
        $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
        $raw = preg_replace('/encoding=["\']ISO-8859-1["\']/i', 'encoding="UTF-8"', $raw);
    }
    $xml = @simplexml_load_string($raw);
    if ($xml === false) { echo json_encode(['error' => 'XML parse-fejl']); exit; }

    // xpath finder alle <afdeling>-noder uanset dybde — PHP 7.4 kompatibelt
    // XML-struktur: <afdeling><id>4001</id><titel>...</titel></afdeling>
    $afdelinger = [];
    $seen       = [];
    foreach ($xml->xpath('//afdelinger/afdeling') ?: [] as $node) {
        $id    = trim((string)$node->id);
        $titel = trim((string)($node->titel ?: $node->navn ?: $node->name ?: ''));
        if ($id && ctype_digit($id) && !isset($seen[$id])) {
            $seen[$id]    = true;
            $afdelinger[] = [
                'id'    => $id,
                'titel' => html_entity_decode($titel, ENT_HTML5 | ENT_QUOTES, 'UTF-8'),
            ];
        }
    }
    echo json_encode(['afdelinger' => $afdelinger, 'count' => count($afdelinger)], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── AFDELING: hent hold for én bestemt afdeling ──────────────────────────────
if ($endpoint === 'afdeling') {
    header('Cache-Control: no-cache');

    $afdelingId = trim($_GET['id'] ?? '');
    if (!$afdelingId || !preg_match('/^\d+$/', $afdelingId)) {
        http_response_code(400);
        echo json_encode(['error' => 'Angiv et gyldigt numerisk afdelings-ID']);
        exit;
    }

    $url = BASE_URL . '?' . http_build_query([
        'forening' => FORENING,
        'key'      => $apiKey,
        'type'     => 'hold',
        'afdeling' => $afdelingId,
    ]);

    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) { echo json_encode(['error' => 'Ingen svar fra Conventus']); exit; }

    $xml = @simplexml_load_string($raw);
    if ($xml === false) { echo json_encode(['error' => 'XML parse-fejl fra Conventus']); exit; }
    if (!empty((string)$xml->error)) { echo json_encode(['error' => (string)$xml->error]); exit; }

    $arr   = xmlToArray($xml);
    $holds = extractHolds($arr);
    usort($holds, fn($a,$b) => strcmp($a['aktivitet_titel'], $b['aktivitet_titel']) ?: strcmp($a['titel'], $b['titel']));

    echo json_encode([
        'holds'   => $holds,
        'count'   => count($holds),
        'fetched' => date('c'),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── GRUPPER: simpel hold-liste til dropdown ───────────────────────────────────
if ($endpoint === 'grupper') {
    header('Cache-Control: public, max-age=1800');
    $url = BASE_URL . '?' . http_build_query([
        'forening' => FORENING,
        'key'      => $apiKey,
        'type'     => 'hold',
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) { echo json_encode(['error' => 'Ingen svar fra Conventus']); exit; }
    $xml = @simplexml_load_string($raw);
    if ($xml === false || !empty((string)$xml->error)) { echo json_encode(['error' => $xml ? (string)$xml->error : 'XML-fejl']); exit; }
    $arr    = xmlToArray($xml);
    $groups = extractHolds($arr);
    echo json_encode(['groups' => $groups, 'count' => count($groups), 'fetched' => date('c')], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── KALENDER: hent begivenheder fra Conventus RSS-feed ───────────────────────
// Returnerer altid HTTP 200 — one.com's Apache erstatter 5xx-svar med HTML,
// så fejl kommunikeres via JSON-feltet "error" i stedet.
if ($endpoint === 'kalender') {
    header('Cache-Control: no-cache');

    $urls = [
        'https://www.conventus.dk/dataudv/www/kalender_rss.php?type_ikon=1&mos=1&dato=1&dato_tidspunkt=1&titel=1&sted=1&klikbar=1&tid=2&niveau=1&gruppe_type=2&rss=1&foreningsid=' . FORENING,
    ];

    $raw = false;
    $usedUrl = '';
    foreach ($urls as $tryUrl) {
        $raw = @file_get_contents($tryUrl, false, $ctx);
        if ($raw !== false && strlen($raw) > 50) { $usedUrl = $tryUrl; break; }
    }

    if ($raw === false || strlen($raw) < 10) {
        echo json_encode([
            'error'  => 'Ingen svar fra Conventus kalender — tjek at RSS-feeden er aktiveret på foreningens side i Conventus.',
            'events' => [],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Encoding-fix
    if (preg_match('/encoding=["\']ISO-8859-1["\']/i', $raw)) {
        $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
        $raw = preg_replace('/encoding=["\']ISO-8859-1["\']/i', 'encoding="UTF-8"', $raw);
    }

    $xml = @simplexml_load_string($raw, 'SimpleXMLElement', LIBXML_NOERROR | LIBXML_NOWARNING);
    if ($xml === false) {
        echo json_encode([
            'error'       => 'Svar fra Conventus er ikke gyldigt XML/RSS.',
            'raw_preview' => substr($raw, 0, 300),
            'events'      => [],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $events  = [];
    $channel = $xml->channel ?? $xml;

    foreach ($channel->item ?? [] as $item) {
        $title   = html_entity_decode(trim((string)($item->title   ?? '')), ENT_HTML5 | ENT_QUOTES, 'UTF-8');
        $desc    = html_entity_decode(trim((string)($item->description ?? '')), ENT_HTML5 | ENT_QUOTES, 'UTF-8');
        $link    = trim((string)($item->link    ?? ''));
        $pubDate = trim((string)($item->pubDate ?? $item->date ?? ''));

        // Søg i namespace-udvidelser efter startdato (eventkalender-formater)
        if (!$pubDate) {
            foreach ($item->getNamespaces(true) as $prefix => $uri) {
                $ext = $item->children($uri);
                foreach (['start', 'startdate', 'startDate', 'startDato', 'dtstart', 'dato'] as $f) {
                    $v = trim((string)($ext->$f ?? ''));
                    if ($v) { $pubDate = $v; break 2; }
                }
            }
        }

        $date = ''; $time = '';
        if ($pubDate) {
            $ts = @strtotime($pubDate);
            if ($ts && $ts > 0) {
                $date = date('Y-m-d', $ts);
                $h    = (int)date('H', $ts);
                $time = $h > 0 ? date('H:i', $ts) : '';
            }
        }

        if ($title) {
            $events[] = [
                'title'       => $title,
                'description' => $desc,
                'date'        => $date,
                'time'        => $time,
                'link'        => $link,
            ];
        }
    }

    usort($events, fn($a, $b) => strcmp($a['date'] ?: '9999', $b['date'] ?: '9999'));

    echo json_encode([
        'events'  => $events,
        'count'   => count($events),
        'fetched' => date('c'),
        'debug'   => ['url' => $usedUrl, 'raw_bytes' => strlen($raw), 'items_found' => count($events)],
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Ukendt endpoint ───────────────────────────────────────────────────────────
// Rå get_membres-data eksponeres ikke via denne proxy.
// Brug sync-members.php (kræver Firebase-auth) til at synkronisere memberdata.
http_response_code(400);
echo json_encode(['error' => 'Ukendt endpoint']);

// ── Hjælpefunktioner ─────────────────────────────────────────────────────────

/**
 * SimpleXML → PHP-array (kompatibel med PHP 7.4+).
 * Attributter gemmes under '@attributes'.
 * Leaf-noder returneres som string.
 */
function xmlToArray(SimpleXMLElement $node) {
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
    // Tom array = leaf-node: returnér tekstindhold som string
    return empty($result) ? trim((string)$node) : $result;
}

/**
 * Udtruk feltværdi fra attributter eller child-elementer.
 * PHP 7.4+: ingen union-type-hint.
 */
function getField($node, string ...$keys): string {
    if (!is_array($node)) return '';
    foreach ($keys as $key) {
        if (isset($node['@attributes'][$key]) && (string)$node['@attributes'][$key] !== '') return (string)$node['@attributes'][$key];
        if (isset($node[$key]) && is_string($node[$key]) && $node[$key] !== '')              return $node[$key];
    }
    return '';
}

/**
 * Rekursivt udtruk alle gruppe-noder og normaliser til hold-objekter.
 * PHP 7.4+: ingen union-type-hint.
 */
function extractHolds($node, array &$seen = []): array {
    if (!is_array($node)) return [];
    $result = [];

    $id = getField($node, 'id');
    if ($id && !isset($seen[$id])) {
        $titel          = getField($node, 'titel', 'navn', 'name');
        $aktivitetTitel = getField($node, 'aktivitet_titel', 'aktivitet');
        $periodeFra     = getField($node, 'periode_fra', 'periodeStart', 'start');
        $periodeTil     = getField($node, 'periode_til', 'periodesSlut', 'slut');
        $beskrivelse    = getField($node, 'om_holdet', 'beskrivelse', 'omholdet');

        if ($titel) {
            $seen[$id] = true;
            $result[] = [
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
            if (is_array($item) || $item instanceof SimpleXMLElement) {
                foreach (extractHolds($item, $seen) as $h) {
                    $result[] = $h;
                }
            }
        }
    }
    return $result;
}
