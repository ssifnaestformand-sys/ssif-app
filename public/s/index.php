<?php
/**
 * Svarside for forældre — ingen Firebase-login krævet.
 *
 * GET  /s/{token}[?svar=kommer|kommer_ikke]
 *   → Viser begivenhedsdata + Kommer/Kommer ikke knapper.
 *     Forudvælger valget hvis ?svar= er sat, men registrerer ALDRIG noget.
 *
 * POST /s/{token}  (form med svar=kommer|kommer_ikke)
 *   → Registrerer svaret i Firestore og viser bekræftelsesside.
 *
 * Mailscanner-beskyttelse: GET ændrer aldrig Firestore, uanset query-parametre.
 */

$saPath = __DIR__ . '/../api/firebase-service-account.json';
if (!file_exists($saPath)) { http_response_code(503); die('Konfigurationsfejl'); }
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];
$fsBase    = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents";

$token = trim($_GET['token'] ?? '');
if (!$token || !preg_match('/^[0-9a-f]{32}$/', $token)) {
    http_response_code(404);
    vis_fejl('Ugyldigt link', 'Dette link er ikke gyldigt. Tjek at du kopierede hele linket fra mailen.');
    exit;
}

$fsToken = hent_sa_token($sa);
if (!$fsToken) { http_response_code(503); vis_fejl('Teknisk fejl', 'Prøv igen om et øjeblik.'); exit; }

// Slå token op i svarlinks
$linkResp = fs_get_s("{$fsBase}/svarlinks/{$token}", $fsToken);
if (!$linkResp) {
    http_response_code(404);
    vis_fejl('Linket er ukendt', 'Prøv at trykke på knappen i mailen igen.');
    exit;
}
$begivenhedId = $linkResp['fields']['begivenhedId']['stringValue'] ?? '';
$memberId     = $linkResp['fields']['memberId']['stringValue']     ?? '';
if (!$begivenhedId || !$memberId) {
    http_response_code(404);
    vis_fejl('Ugyldigt link', 'Dette link er ikke gyldigt.');
    exit;
}

// Hent begivenhed
$bevResp = fs_get_s("{$fsBase}/begivenheder/{$begivenhedId}", $fsToken);
if (!$bevResp) {
    vis_fejl('Begivenhed ikke fundet', 'Begivenheden eksisterer ikke længere.');
    exit;
}
$bf    = $bevResp['fields'];
$dato  = $bf['dato']['stringValue'] ?? '';

// Tjek om begivenheden er afholdt
if ($dato && strtotime($dato . ' 23:59:59') < time()) {
    vis_side_afholdt($bf);
    exit;
}

// Hent deltagerens nuværende svar
$deltResp    = fs_get_s("{$fsBase}/begivenheder/{$begivenhedId}/deltagere/{$memberId}", $fsToken);
$deltFields  = $deltResp ? ($deltResp['fields'] ?? []) : [];
$nuvsvar     = $deltFields['svar']['stringValue'] ?? null;
$navn        = $deltFields['navn']['stringValue']  ?? '';

// ── POST: registrér svar ──────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $svar = trim($_POST['svar'] ?? '');
    if (!in_array($svar, ['kommer', 'kommer_ikke'], true)) {
        http_response_code(400);
        vis_fejl('Ugyldigt svar', 'Tryk på en af knapperne for at svare.');
        exit;
    }

    $now       = date('Y-m-d\TH:i:s\Z');
    $maskParts = 'updateMask.fieldPaths=svar&updateMask.fieldPaths=svarTidspunkt';
    $patchUrl  = "{$fsBase}/begivenheder/{$begivenhedId}/deltagere/{$memberId}?{$maskParts}";
    $patchResp = @file_get_contents($patchUrl, false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => [
            'svar'          => ['stringValue' => $svar],
            'svarTidspunkt' => ['timestampValue' => $now],
        ]]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));

    if (!$patchResp || isset(json_decode($patchResp ?: '', true)['error'])) {
        vis_fejl('Teknisk fejl', 'Svaret kunne ikke gemmes. Prøv igen.');
        exit;
    }

    vis_bekræftelse($navn, $svar, $bf);
    exit;
}

// ── GET: vis svarside ─────────────────────────────────────────────────────────
$forudvalgt = trim($_GET['svar'] ?? '');
if (!in_array($forudvalgt, ['kommer', 'kommer_ikke'], true)) $forudvalgt = '';

vis_svarside($navn, $nuvsvar, $forudvalgt, $bf, $token);

// ── Sidefunktioner ────────────────────────────────────────────────────────────

function vis_svarside(string $navn, ?string $nuvsvar, string $forudvalgt, array $bf, string $token): void {
    $titel    = htmlspecialchars($bf['titel']['stringValue'] ?? '');
    $type     = $bf['type']['stringValue'] ?? '';
    $dato     = htmlspecialchars($bf['dato']['stringValue'] ?? '');
    $tid      = htmlspecialchars($bf['tidspunkt']['stringValue'] ?? '');
    $modetid  = htmlspecialchars($bf['modetid']['stringValue'] ?? '');
    $sted     = htmlspecialchars($bf['sted']['stringValue'] ?? '');
    $besk     = htmlspecialchars($bf['beskrivelse']['stringValue'] ?? '');
    $navnEnc  = htmlspecialchars($navn);

    $typeLabel = ['kamp'=>'Kamp','stævne'=>'Stævne','event'=>'Event','møde'=>'Møde'][$type] ?? ucfirst($type);

    $datoDk = dato_dk_s($bf['dato']['stringValue'] ?? '');
    $detDetaljer = '';
    if ($dato)    $detDetaljer .= "<div class=\"det\"><span>Dato</span><strong>{$datoDk}</strong></div>";
    if ($tid)     $detDetaljer .= "<div class=\"det\"><span>Tidspunkt</span><strong>{$tid}</strong></div>";
    if ($modetid) $detDetaljer .= "<div class=\"det\"><span>Mødetid</span><strong>{$modetid}</strong></div>";
    if ($sted)    $detDetaljer .= "<div class=\"det\"><span>Sted</span><strong>{$sted}</strong></div>";

    $beskHtml = $besk ? "<p class=\"besk\">{$besk}</p>" : '';

    $aktuelSvar = $forudvalgt ?: $nuvsvar ?: '';
    $kommerClass = $aktuelSvar === 'kommer' ? ' selected' : '';
    $ikkeClass   = $aktuelSvar === 'kommer_ikke' ? ' selected' : '';

    $tidlSvarHtml = '';
    if ($nuvsvar) {
        $label = $nuvsvar === 'kommer' ? 'Du har svaret "Kommer"' : 'Du har svaret "Kommer ikke"';
        $tidlSvarHtml = "<p class=\"curr-svar\">{$label} — du kan ændre dit svar herunder.</p>";
    }

    $postUrl = '/s/' . rawurlencode($token);

    header('Content-Type: text/html; charset=UTF-8');
    echo html_hoved('Svar på invitation — Sejs-Svejbæk IF');
    echo <<<HTML
<div class="card">
  <div class="topbar">&#9917; SSIF Tr&aelig;ner</div>
  <div class="body">
    <p class="hilsen">Hej {$navnEnc},</p>
    <h1>Du er udtaget til {$typeLabel}</h1>
    <div class="detaljer">{$detDetaljer}</div>
    {$beskHtml}
    {$tidlSvarHtml}
    <p class="spørgsmål">Kan du komme?</p>
    <form method="POST" action="{$postUrl}">
      <div class="btn-row">
        <button type="submit" name="svar" value="kommer" class="bsvar kommer{$kommerClass}">
          Kommer &#10003;
        </button>
        <button type="submit" name="svar" value="kommer_ikke" class="bsvar ikke{$ikkeClass}">
          Kommer ikke
        </button>
      </div>
    </form>
    <p class="footer">Sejs-Svejb&aelig;k IF</p>
  </div>
</div>
HTML;
    echo '</body></html>';
}

function vis_bekræftelse(string $navn, string $svar, array $bf): void {
    $titel   = htmlspecialchars($bf['titel']['stringValue'] ?? '');
    $navnEnc = htmlspecialchars($navn);
    if ($svar === 'kommer') {
        $ikon = '&#10003;'; $farve = '#1a5c2a'; $tekst = 'Tak! Vi ses til';
    } else {
        $ikon = '&#10005;'; $farve = '#dc2626'; $tekst = 'Ok, du er frameldt';
    }

    header('Content-Type: text/html; charset=UTF-8');
    echo html_hoved('Svar registreret — Sejs-Svejbæk IF');
    echo <<<HTML
<div class="card">
  <div class="topbar" style="background:{$farve}">&#9917; SSIF Tr&aelig;ner</div>
  <div class="body" style="text-align:center">
    <div class="ikon-stor" style="color:{$farve}">{$ikon}</div>
    <h1>{$tekst} {$titel}</h1>
    <p style="font-size:14px;color:#4a4a4a">Hej {$navnEnc} — dit svar er gemt.</p>
    <p class="footer">Sejs-Svejb&aelig;k IF</p>
  </div>
</div>
HTML;
    echo '</body></html>';
}

function vis_side_afholdt(array $bf): void {
    $titel = htmlspecialchars($bf['titel']['stringValue'] ?? '');
    header('Content-Type: text/html; charset=UTF-8');
    echo html_hoved('Begivenhed afholdt — Sejs-Svejbæk IF');
    echo <<<HTML
<div class="card">
  <div class="topbar">&#9917; SSIF Tr&aelig;ner</div>
  <div class="body" style="text-align:center">
    <div class="ikon-stor">&#128197;</div>
    <h1>{$titel}</h1>
    <p style="font-size:14px;color:#4a4a4a">Denne begivenhed er allerede afholdt.</p>
    <p class="footer">Sejs-Svejb&aelig;k IF</p>
  </div>
</div>
HTML;
    echo '</body></html>';
}

function vis_fejl(string $overskrift, string $besked): void {
    header('Content-Type: text/html; charset=UTF-8');
    echo html_hoved("{$overskrift} — Sejs-Svejbæk IF");
    $overskriftEnc = htmlspecialchars($overskrift);
    $beskedEnc     = htmlspecialchars($besked);
    echo <<<HTML
<div class="card">
  <div class="topbar">&#9917; SSIF Tr&aelig;ner</div>
  <div class="body" style="text-align:center">
    <div class="ikon-stor">&#9888;</div>
    <h1>{$overskriftEnc}</h1>
    <p style="font-size:14px;color:#4a4a4a">{$beskedEnc}</p>
    <p class="footer">Sejs-Svejb&aelig;k IF</p>
  </div>
</div>
HTML;
    echo '</body></html>';
}

function html_hoved(string $title): string {
    $titleEnc = htmlspecialchars($title);
    return <<<HTML
<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{$titleEnc}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f4f6f4;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{width:100%;max-width:440px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08)}
.topbar{background:#1a5c2a;color:#fff;padding:16px 20px;font-size:17px;font-weight:800}
.body{padding:24px 20px;display:flex;flex-direction:column;gap:14px}
h1{font-size:20px;font-weight:800;color:#1a1a1a;line-height:1.25}
.hilsen{font-size:14px;color:#4a4a4a}
.detaljer{display:flex;flex-direction:column;gap:0;border:1px solid #dde5dd;border-radius:10px;overflow:hidden}
.det{display:flex;gap:10px;padding:9px 14px;border-bottom:1px solid #dde5dd;font-size:14px}
.det:last-child{border-bottom:none}
.det span{font-size:12px;font-weight:700;color:#888;width:30%;flex-shrink:0;padding-top:1px}
.det strong{font-weight:600;color:#1a1a1a}
.besk{font-size:13px;color:#4a4a4a;line-height:1.6}
.curr-svar{font-size:13px;color:#1a5c2a;font-weight:600;background:#e8f5ec;border-radius:8px;padding:8px 12px}
.spørgsmål{font-size:15px;font-weight:700;text-align:center;color:#1a1a1a}
.btn-row{display:flex;gap:10px}
.bsvar{flex:1;padding:13px 0;border-radius:11px;font-size:15px;font-weight:700;cursor:pointer;border:1.5px solid transparent;transition:opacity .1s}
.bsvar:active{opacity:.75}
.bsvar.kommer{background:#fff;color:#1a5c2a;border-color:#dde5dd}
.bsvar.kommer.selected{background:#1a5c2a;color:#fff;border-color:#1a5c2a}
.bsvar.ikke{background:#fff;color:#dc2626;border-color:#fecaca}
.bsvar.ikke.selected{background:#dc2626;color:#fff;border-color:#dc2626}
.ikon-stor{font-size:48px;line-height:1;text-align:center}
.footer{font-size:12px;color:#aaa;text-align:center;margin-top:6px}
</style>
</head>
<body>
HTML;
}

// ── Firestore + OAuth ─────────────────────────────────────────────────────────

function hent_sa_token(array $sa): string {
    $now = time();
    $h   = rtrim(strtr(base64_encode(json_encode(['alg' => 'RS256', 'typ' => 'JWT'])), '+/', '-_'), '=');
    $p   = rtrim(strtr(base64_encode(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/datastore',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ])), '+/', '-_'), '=');
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . rtrim(strtr(base64_encode($sig), '+/', '-_'), '=');
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content'       => http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}

function fs_get_s(string $url, string $token): ?array {
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'GET',
        'header'        => "Authorization: Bearer {$token}\r\n",
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    if (!$resp) return null;
    $data = json_decode($resp, true);
    return isset($data['fields']) ? $data : null;
}

function dato_dk_s(string $dato): string {
    if (!$dato) return '';
    $parts  = explode('-', $dato);
    $months = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
    $dows   = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];
    $ts     = mktime(12, 0, 0, (int)($parts[1] ?? 1), (int)($parts[2] ?? 1), (int)($parts[0] ?? 2000));
    return $dows[(int)date('w', $ts)] . ' d. ' . (int)($parts[2] ?? 0) . '. ' . ($months[(int)($parts[1] ?? 1) - 1] ?? '');
}
