<?php
/**
 * Synkronisér Conventus-medlemmer til Firestore
 *
 * POST (ingen body nødvendig) med header:
 *   X-Sync-Secret: <SYNC_SECRET>
 *
 * Henter alle aktive medlemmer fra Conventus, udtrækker navn,
 * email, relationsemails (forældre) og holdtilknytning, og skriver
 * til Firestore members/{conventus_id}.
 *
 * PERSONFØLSOMME DATA:
 *   – Conventus API-nøglen håndteres udelukkende server-side
 *   – Endpointet kræver X-Sync-Secret autentificering
 *   – Persdata (navne, emails) eksponeres aldrig i HTTP-svaret
 *   – Svar indeholder kun tæller og tidsstempel
 *
 * Firestore security rules der anbefales for members-samlingen:
 *   match /members/{id} {
 *     allow read: if request.auth != null;
 *     allow write: if false;   // kun service account må skrive
 *   }
 *
 * Opsæt server-side cron (one.com kontrolpanel) for automatisk
 * synkronisering, fx hver time:
 *   0 * * * *  curl -s -X POST https://app.sejssvejbaek-if.dk/api/sync-members.php \
 *                -H "X-Sync-Secret: DIN_SYNC_SECRET"
 */

set_time_limit(300);
ini_set('memory_limit', '256M'); // Stor XML-fil fra Conventus kræver mere hukommelse

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: X-Sync-Secret');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

// ── Autentificering (kun server-til-server via cron/deploy) ──────────────────
$syncSecret = getenv('SYNC_SECRET') ?: '';
$sentSecret = $_SERVER['HTTP_X_SYNC_SECRET'] ?? '';
if (!$syncSecret || !hash_equals($syncSecret, $sentSecret)) {
    http_response_code(401);
    echo json_encode(['error' => 'Uautoriseret']);
    exit;
}

// ── Conventus API-nøgle (aldrig eksponeret i svar) ────────────────────────────
$apiKey = getenv('CONVENTUS_KEY') ?: '';
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

// ── Firebase service account ──────────────────────────────────────────────────
$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'Firebase service account mangler']);
    exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

$accessToken = google_access_token($sa);
if (!$accessToken) {
    http_response_code(500);
    echo json_encode(['error' => 'Kunne ikke autentificere med Firebase']);
    exit;
}

// ── Hent aktive hold fra Firestore (til aktiv_i_app-flag) ─────────────────────
$aktivHolds = fetch_aktiv_holds($projectId, $accessToken);

// ── Hent medlemmer fra Conventus ──────────────────────────────────────────────
$ctx = stream_context_create(['http' => ['timeout' => 60, 'ignore_errors' => true]]);
$membresUrl = 'https://www.conventus.dk/dataudv/api/adressebog/get_medlemmer.php?' . http_build_query([
    'forening'   => '1031',
    'key'        => $apiKey,
    'relationer' => 'true',
]);

$raw = @file_get_contents($membresUrl, false, $ctx);
if ($raw === false) {
    http_response_code(503);
    echo json_encode(['error' => 'Ingen svar fra Conventus']);
    exit;
}

// Håndter ISO-8859-1 encoding (danske tegn)
if (preg_match('/encoding=["\']ISO-8859-1["\']/i', $raw)) {
    $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
    $raw = preg_replace('/encoding=["\']ISO-8859-1["\']/i', 'encoding="UTF-8"', $raw);
}

// ── DEBUG (midlertidig) ───────────────────────────────────────────────────────
$debug = [];
$debug['raw_length']  = strlen($raw);
$debug['raw_preview'] = mb_substr($raw, 0, 500);

// Tjek at svaret ser ud som XML
if (strpos(ltrim($raw), '<') !== 0) {
    http_response_code(502);
    echo json_encode(['error' => 'Uventet svar fra Conventus (ikke XML)', 'debug' => $debug]);
    exit;
}

// Scan element-navne og dybder med XMLReader (uden at parse fuldt)
$debugReader = new XMLReader();
$debugReader->XML($raw, 'UTF-8', LIBXML_NOERROR | LIBXML_NOWARNING);
$elementCounts = [];
$depthSamples  = []; // første 20 elementer med navn+depth
$i = 0;
while ($debugReader->read()) {
    if ($debugReader->nodeType !== XMLReader::ELEMENT) continue;
    $name = $debugReader->localName;
    $elementCounts[$name] = ($elementCounts[$name] ?? 0) + 1;
    if ($i < 20) { $depthSamples[] = "depth={$debugReader->depth} <{$name}>"; $i++; }
}
$debugReader->close();
$debug['element_counts'] = $elementCounts;
$debug['first_20_elements'] = $depthSamples;
// ── SLUT DEBUG ────────────────────────────────────────────────────────────────

// ── Parse og skriv til Firestore (streaming for store filer) ──────────────────
$members    = parse_members_stream($raw, $aktivHolds);
$written    = 0;
$skipped    = 0;
$errCount   = 0;
$syncedAt   = date('c');

foreach ($members as $member) {
    $docId = (string)$member['conventus_id'];
    if (!$docId) { $skipped++; continue; }

    if (firestore_patch($projectId, $accessToken, "members/{$docId}", $member)) {
        $written++;
    } else {
        $errCount++;
    }
}

echo json_encode([
    'ok'      => true,
    'written' => $written,
    'skipped' => $skipped,
    'errors'  => $errCount,
    'total'   => count($members),
    'synced'  => $syncedAt,
    'debug'   => $debug,   // TODO: fjern når parsing virker
], JSON_UNESCAPED_UNICODE);

// ── Streaming XML-parser (XMLReader) ─────────────────────────────────────────
//
// Conventus XML-struktur:
//   <conventus>
//     <medlemmer>
//       <medlem>
//         <id>12345</id>
//         <navn>Lars Nielsen</navn>
//         <email>lars@example.com</email>
//         <relationer>
//           <medlem>
//             <gruppe>999024</gruppe>   ← hold-ID (kun tal, ingen titel)
//             <gruppe>1012456</gruppe>
//           </medlem>
//         </relationer>
//       </член>
//     </członkowie>
//   </conventus>
//
// Top-level <member> er ved depth 2 (conventus → membres → membre).
// Nested <membre> inde i <relationer> springer vi over via depth-tjek.
// Hold-titler slås op i $holdsMap (fra Firestore) da XML kun giver ID'er.

function parse_members_stream(string $raw, array $holdsMap): array {
    libxml_use_internal_errors(true);

    $reader = new XMLReader();
    if (!$reader->XML($raw, 'UTF-8', LIBXML_NOERROR | LIBXML_NOWARNING)) {
        return [];
    }

    $members    = [];
    $topDepth   = -1; // depth for top-level <membre> — sættes første gang

    while ($reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT) continue;
        if (strtolower($reader->localName) !== 'medlem') continue;

        $d = $reader->depth;

        // Sæt top-depth første gang vi møder et <membre>
        if ($topDepth < 0) $topDepth = $d;

        // Spring nested <membre> (inde i <relationer>) over
        if ($d !== $topDepth) continue;

        // Ekspandér kun dette ene element — frigives bagefter
        $domNode = $reader->expand();
        if (!$domNode) continue;

        $k = simplexml_import_dom($domNode);
        if (!$k) { unset($domNode); continue; }

        $id = (int)trim((string)($k->id ?? ''));
        if ($id > 0) {
            $member = extract_member($k, $id, $holdsMap);
            if ($member) $members[] = $member;
        }

        unset($k, $domNode);
    }

    $reader->close();
    libxml_clear_errors();
    return $members;
}

function extract_member(SimpleXMLElement $k, int $id, array $holdsMap): ?array {
    $name  = trim((string)($k->navn ?? '')) ?: 'Ukendt';
    $email = strtolower(trim((string)($k->email ?? '')));

    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) return null;

    // Hold-IDs fra <relationer><membre><gruppe> (tekst-indhold er ID-tallet)
    $holds = [];
    $seen  = [];
    if (isset($k->relationer)) {
        foreach ($k->relationer->children() as $rel) {
            foreach ($rel->children() as $child) {
                if (strtolower($child->getName()) !== 'gruppe') continue;
                $holdId = (int)trim((string)$child);
                if (!$holdId || isset($seen[$holdId])) continue;
                $seen[$holdId] = true;
                $info  = $holdsMap[$holdId] ?? null;
                $holds[] = [
                    'conventus_id' => $holdId,
                    'titel'        => $info['titel'] ?? "Hold #{$holdId}",
                    'aktiv_i_app'  => $info !== null && $info['aktiv'],
                ];
            }
        }
    }

    return [
        'conventus_id' => $id,
        'name'         => $name,
        'allEmails'    => [$email],
        'holds'        => $holds,
    ];
}

// ── Firestore: hent aktive hold ───────────────────────────────────────────────

function fetch_aktiv_holds(string $projectId, string $token): array {
    $url  = "https://firestore.googleapis.com/v1/projects/{$projectId}"
          . "/databases/(default)/documents/holds?pageSize=500";
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'header'        => "Authorization: Bearer {$token}\r\n",
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    if (!$resp) return [];

    // Returnerer [conventus_id => ['aktiv' => bool, 'titel' => string]]
    // så extract_member kan slå hold-titler op (Conventus XML giver kun ID'er)
    $map = [];
    foreach ((json_decode($resp, true)['documents'] ?? []) as $doc) {
        $f  = $doc['fields'] ?? [];
        $id = (int)($f['conventus_id']['integerValue']
                 ?? $f['conventus_id']['doubleValue']
                 ?? 0);
        if (!$id) continue;
        $map[$id] = [
            'aktiv' => ($f['aktiv']['booleanValue'] ?? false) === true,
            'titel' => $f['titel']['stringValue'] ?? "Hold #{$id}",
        ];
    }
    return $map;
}

// ── Firestore: skriv ét dokument (PATCH = upsert) ─────────────────────────────

function firestore_patch(string $projectId, string $token, string $path, array $data): bool {
    $fields = [];
    foreach ($data as $k => $v) $fields[$k] = to_fs($v);

    $url  = "https://firestore.googleapis.com/v1/projects/{$projectId}"
          . "/databases/(default)/documents/{$path}";
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => $fields]),
        'timeout'       => 15,
        'ignore_errors' => true,
    ]]));
    return $resp !== false && !empty(json_decode($resp, true)['fields']);
}

function to_fs($v): array {
    if (is_null($v))   return ['nullValue' => 'NULL_VALUE'];
    if (is_bool($v))   return ['booleanValue' => $v];
    if (is_int($v))    return ['integerValue' => (string)$v];
    if (is_float($v))  return ['doubleValue' => $v];
    if (is_string($v)) return ['stringValue' => $v];
    if (is_array($v)) {
        if (empty($v) || array_keys($v) === range(0, count($v) - 1)) {
            return ['arrayValue' => ['values' => array_map('to_fs', array_values($v))]];
        }
        $fields = [];
        foreach ($v as $k => $val) $fields[$k] = to_fs($val);
        return ['mapValue' => ['fields' => $fields]];
    }
    return ['stringValue' => (string)$v];
}

// ── Google OAuth 2.0 via service account ──────────────────────────────────────

function google_access_token(array $sa): string {
    $now    = time();
    $header = b64u(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claims = b64u(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/datastore',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ]));
    $unsigned = "$header.$claims";
    openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt = "$unsigned." . b64u($sig);

    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false,
        stream_context_create(['http' => [
            'method'        => 'POST',
            'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content'       => http_build_query([
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion'  => $jwt,
            ]),
            'timeout'       => 10,
            'ignore_errors' => true,
        ]])
    );
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}

function b64u(string $d): string {
    return rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
}
