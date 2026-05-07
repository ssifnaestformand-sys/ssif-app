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

// ── Udtruk hvert hold som selvstændige blokke ────────────────────────────────
$groups = [];
$seen   = [];

// Opdel HTML i individuelle con_activity blokke
preg_match_all('/<div class="con_activity"[^>]*>(.*?)(?=<div class="con_activity"|$)/s', $html, $rawBlocks);

foreach ($rawBlocks[0] as $block) {
    // Idrætgrens-ID
    if (!preg_match('/data-activity_type="(\d+)"/', $block, $mType)) continue;
    $typeId = $mType[1];

    // Gruppe-ID
    if (!preg_match('/url_(\d+)\s*=/', $block, $mId)) continue;
    $gid = (int)$mId[1];
    if (isset($seen[$gid])) continue;
    $seen[$gid] = true;

    // Holdnavn fra første <h2>
    if (!preg_match('/<h2>(.*?)<\/h2>/', $block, $mName)) continue;
    $name = html_entity_decode(strip_tags($mName[1]), ENT_HTML5 | ENT_QUOTES, 'UTF-8');

    // Idrætsgren – spring over hvis ukendt (typisk "ikke-idræt")
    $typeName = $activityTypes[$typeId] ?? null;
    if ($typeName === null) continue;

    // Trænings­tid, f.eks. "D. 01.08 - 31.07 - kl. 16:30 - 18:00"
    $periode = null;
    if (preg_match('/class="periode">([^<]+)<\/span>/', $block, $mPer)) {
        $raw = html_entity_decode(trim($mPer[1]), ENT_HTML5 | ENT_QUOTES, 'UTF-8');
        // Uddrag kun klokkeslet: "kl. 16:30 - 18:00"
        if (preg_match('/(kl\.\s*\d{2}:\d{2}(?:\s*-\s*\d{2}:\d{2})?)/', $raw, $mTime)) {
            $periode = trim($mTime[1]);
        }
        // Uddrag periode: "01.08 - 31.07"
        if (preg_match('/(\d{2}\.\d{2})\s*-\s*(\d{2}\.\d{2})/', $raw, $mDates)) {
            $periode = ($periode ? $periode . '  ·  ' : '') . $mDates[1] . ' – ' . $mDates[2];
        }
    }

    $groups[] = [
        'id'               => $gid,
        'name'             => $name,
        'activityTypeId'   => $typeId,
        'activityTypeName' => $typeName,
        'periode'          => $periode,
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
