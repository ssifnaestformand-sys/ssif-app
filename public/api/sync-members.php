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

set_time_limit(600);
ignore_user_abort(true);         // Fortsæt selv om curl/HTTP-forbindelsen afbrydes
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

// ── Hent hold-titler fra Firestore (til brug ved opslag på conventus_id) ──────
$aktivHolds = fetch_holds_map($projectId, $accessToken);

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

// Tjek at svaret ser ud som XML
if (strpos(ltrim($raw), '<') !== 0) {
    http_response_code(502);
    echo json_encode(['error' => 'Uventet svar fra Conventus (ikke XML)']);
    exit;
}

// ── Parse + batch-skriv til Firestore ────────────────────────────────────────
// Individuelle PATCH-kald (ét pr. medlem) tager ~860s for 2873 membres.
// Firestore batch-commit: op til 500 dokumenter pr. kald → ~6 kald i alt.
$members  = parse_members_stream($raw, $aktivHolds);
$syncedAt = date('c');
$result   = firestore_batch_commit($projectId, $accessToken, $members);

echo json_encode([
    'ok'      => true,
    'written' => $result['written'],
    'errors'  => $result['errors'],
    'total'   => count($members),
    'synced'  => $syncedAt,
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

    $members = [];
    global $g_debug_first_member;
    $g_debug_first_member = null;

    while ($reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT) continue;
        if (strtolower($reader->localName) !== 'medlem') continue;
        if ($reader->depth !== 2) continue;

        $xml = $reader->readOuterXml();
        $reader->next();
        if (!$xml) continue;

        $k = @simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NOERROR | LIBXML_NOWARNING);
        if (!$k) continue;

        $id = (int)trim((string)($k->id ?? ''));
        if ($id > 0) {
            $member = extract_member($k, $id, $holdsMap);
            if ($member) $members[] = $member;
        }

        unset($k);
    }

    $reader->close();
    libxml_clear_errors();
    return $members;
}

function extract_member(SimpleXMLElement $k, int $id, array $holdsMap): ?array {
    $name  = trim((string)($k->navn ?? '')) ?: 'Ukendt';
    $email = strtolower(trim((string)($k->email ?? '')));

    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) return null;

    // Hold-IDs fra <relationer><leder|membre><gruppe>
    // <leder>-relationer bruges til at identificere trænere/ledere
    $holds      = [];
    $lederHolds = [];
    $seen       = [];

    if (isset($k->relationer)) {
        foreach ($k->relationer->children() as $relType) {
            $isLeder = strtolower($relType->getName()) === 'leder';
            foreach ($relType->children() as $child) {
                if (strtolower($child->getName()) !== 'gruppe') continue;
                $holdId = (int)trim((string)$child);
                if (!$holdId) continue;
                if ($isLeder && !in_array($holdId, $lederHolds, true)) {
                    $lederHolds[] = $holdId;
                }
                if (isset($seen[$holdId])) continue;
                $seen[$holdId] = true;
                $holds[] = [
                    'conventus_id' => $holdId,
                    'titel'        => $holdsMap[$holdId]['titel'] ?? "Hold #{$holdId}",
                ];
            }
        }
    }

    return [
        'conventus_id' => $id,
        'name'         => $name,
        'allEmails'    => [$email],
        'holds'        => $holds,
        'holdIds'      => array_map(fn($h) => (string)$h['conventus_id'], $holds),
        'lederHolds'   => $lederHolds,
        'isLeder'      => !empty($lederHolds),
    ];
}

// ── Firestore: hent hold-titler (conventus_id → titel) ───────────────────────
// Bruges til at give holds et rigtigt navn i member-dokumentet,
// da Conventus XML kun giver ID'er på holdtilmeldinger.
// Alle holds hentes — ingen filtrering.

function fetch_holds_map(string $projectId, string $token): array {
    $map      = [];
    $pageToken = null;

    do {
        $qs   = 'pageSize=500' . ($pageToken ? '&pageToken=' . urlencode($pageToken) : '');
        $url  = "https://firestore.googleapis.com/v1/projects/{$projectId}"
              . "/databases/(default)/documents/holds?{$qs}";
        $resp = @file_get_contents($url, false, stream_context_create(['http' => [
            'header'        => "Authorization: Bearer {$token}\r\n",
            'timeout'       => 15,
            'ignore_errors' => true,
        ]]));
        if (!$resp) break;

        $data = json_decode($resp, true);
        foreach ($data['documents'] ?? [] as $doc) {
            $f  = $doc['fields'] ?? [];
            $id = (int)($f['conventus_id']['integerValue']
                     ?? $f['conventus_id']['doubleValue']
                     ?? 0);
            if (!$id) continue;
            $map[$id] = ['titel' => $f['titel']['stringValue'] ?? "Hold #{$id}"];
        }
        $pageToken = $data['nextPageToken'] ?? null;
    } while ($pageToken);

    return $map;
}

// ── Firestore: skriv ét dokument (PATCH = upsert) ─────────────────────────────

// Firestore batch-commit: op til 500 dokumenter pr. HTTP-kald.
// 2873 membres → ~6 kald i stedet for 2873 individuelle PATCH-kald.
function firestore_batch_commit(string $projectId, string $token, array $members): array {
    // Firestore document name = resource-sti, IKKE fuld HTTPS-URL
    $apiBase  = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)";
    $docPath  = "projects/{$projectId}/databases/(default)/documents/members";
    $written  = 0;
    $errors   = 0;

    foreach (array_chunk($members, 500) as $chunk) {
        $writes = [];
        foreach ($chunk as $member) {
            $docId  = (string)($member['conventus_id'] ?? '');
            if (!$docId) continue;
            $fields = [];
            foreach ($member as $k => $v) $fields[$k] = to_fs($v);
            $writes[] = ['update' => ['name' => "{$docPath}/{$docId}", 'fields' => $fields]];
        }
        if (!$writes) continue;

        $resp = @file_get_contents("{$apiBase}/documents:commit", false,
            stream_context_create(['http' => [
                'method'        => 'POST',
                'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
                'content'       => json_encode(['writes' => $writes]),
                'timeout'       => 60,
                'ignore_errors' => true,
            ]])
        );

        $data = json_decode($resp ?: '', true);
        if ($resp && isset($data['writeResults'])) {
            $written += count($data['writeResults']);
        } else {
            $errors += count($writes);
        }
    }

    return ['written' => $written, 'errors' => $errors];
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
