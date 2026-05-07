<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=1800'); // 30 min cache

$url = 'https://www.conventus.dk/dataudv/www/gruppeaktiviteter.php'
     . '?foreningsid=1031&arranger=1';

$ctx  = stream_context_create(['http' => ['timeout' => 10]]);
$html = @file_get_contents($url, false, $ctx);

if ($html === false) {
    http_response_code(503);
    echo json_encode(['error' => 'Kunne ikke hente data fra Conventus']);
    exit;
}

// ── Udtruk idrætsgrens-navne fra <select id="input_activity_type"> ──────────
$activityTypes = [];
if (preg_match(
    '/<select[^>]*id="input_activity_type"[^>]*>(.*?)<\/select>/s',
    $html, $sel
)) {
    preg_match_all(
        '/<option value="(\d+)">([^<]+)<\/option>/',
        $sel[1], $opts, PREG_SET_ORDER
    );
    foreach ($opts as $o) {
        $activityTypes[$o[1]] = html_entity_decode(trim($o[2]), ENT_HTML5 | ENT_QUOTES, 'UTF-8');
    }
}

// ── Udtruk hvert hold: activityType + gruppe-id + navn ───────────────────────
$groups = [];
$seen   = [];

preg_match_all(
    '/class="con_activity"[^>]*data-activity_type="(\d+)"[^>]*>.*?url_(\d+)\s*=.*?<h2>(.*?)<\/h2>/s',
    $html, $matches, PREG_SET_ORDER
);

foreach ($matches as $m) {
    $gid = (int)$m[2];
    if (isset($seen[$gid])) continue;
    $seen[$gid] = true;

    $name     = html_entity_decode(strip_tags($m[3]), ENT_HTML5 | ENT_QUOTES, 'UTF-8');
    $typeId   = $m[1];
    $typeName = $activityTypes[$typeId] ?? null;

    // Spring aktiviteter uden idrætgrens-navn over (typisk "ikke-idræt")
    if ($typeName === null) continue;

    $groups[] = [
        'id'               => $gid,
        'name'             => $name,
        'activityTypeId'   => $typeId,
        'activityTypeName' => $typeName,
    ];
}

// Sortér: idrætgren → holdnavn
usort($groups, fn($a,$b) =>
    strcmp($a['activityTypeName'], $b['activityTypeName']) ?:
    strcmp($a['name'], $b['name'])
);

echo json_encode([
    'activityTypes' => $activityTypes,
    'groups'        => $groups,
    'count'         => count($groups),
    'fetched'       => date('c'),
], JSON_UNESCAPED_UNICODE);
