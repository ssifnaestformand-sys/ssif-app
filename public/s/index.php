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
$lf                = $linkResp['fields'];
$begivenhedId      = $lf['begivenhedId']['stringValue']      ?? '';
$tilkendegivelseId = $lf['tilkendegivelseId']['stringValue'] ?? '';
$memberId          = $lf['memberId']['stringValue']           ?? '';

if (!$memberId) {
    http_response_code(404);
    vis_fejl('Ugyldigt link', 'Dette link er ikke gyldigt.');
    exit;
}

// ══ Tilkendegivelse-flow ══════════════════════════════════════════════════════
if ($tilkendegivelseId) {
    $tResp = fs_get_s("{$fsBase}/tilkendegivelser/{$tilkendegivelseId}", $fsToken);
    if (!$tResp) {
        vis_fejl('Tilkendegivelsen er lukket', 'Tilkendegivelsen eksisterer ikke længere.');
        exit;
    }
    $tf     = $tResp['fields'];
    $status = $tf['status']['stringValue'] ?? 'udsendt';

    if ($status === 'lukket') {
        vis_tilkendegivelse_lukket($tf);
        exit;
    }

    $datoer = [];
    foreach ($tf['datoer']['arrayValue']['values'] ?? [] as $d) {
        $df = $d['mapValue']['fields'] ?? [];
        $dato = $df['dato']['stringValue'] ?? '';
        if ($dato) $datoer[] = [
            'dato'      => $dato,
            'tidspunkt' => $df['tidspunkt']['stringValue'] ?? '',
            'modetid'   => $df['modetid']['stringValue']   ?? '',
            'sted'      => $df['sted']['stringValue']      ?? '',
        ];
    }

    // Tjek om alle datoer er passeret
    $allePaseret = true;
    foreach ($datoer as $d) {
        if (strtotime($d['dato'] . ' 23:59:59') >= time()) { $allePaseret = false; break; }
    }
    if ($allePaseret) {
        vis_tilkendegivelse_lukket($tf);
        exit;
    }

    $deltResp   = fs_get_s("{$fsBase}/tilkendegivelser/{$tilkendegivelseId}/deltagere/{$memberId}", $fsToken);
    $deltFields = $deltResp ? ($deltResp['fields'] ?? []) : [];
    $navn       = $deltFields['navn']['stringValue'] ?? '';
    $nuværendeSvar = [];
    foreach ($deltFields['svar']['mapValue']['fields'] ?? [] as $datKey => $v) {
        $nuværendeSvar[$datKey] = $v['stringValue'] ?? '';
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $postSvar = is_array($_POST['svar'] ?? null) ? $_POST['svar'] : [];
        $merged   = $nuværendeSvar;
        foreach ($postSvar as $dato => $val) {
            if (in_array($val, ['kan', 'kan_ikke'], true)) {
                $merged[$dato] = $val;
            }
        }

        $svarFields = [];
        foreach ($merged as $dato => $val) {
            $svarFields[$dato] = ['stringValue' => $val];
        }

        $now      = date('Y-m-d\TH:i:s\Z');
        $patchUrl = "{$fsBase}/tilkendegivelser/{$tilkendegivelseId}/deltagere/{$memberId}"
                  . '?updateMask.fieldPaths=svar&updateMask.fieldPaths=opdateretAt';
        $patchResp = @file_get_contents($patchUrl, false, stream_context_create(['http' => [
            'method'        => 'PATCH',
            'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
            'content'       => json_encode(['fields' => [
                'svar'        => ['mapValue' => ['fields' => $svarFields]],
                'opdateretAt' => ['timestampValue' => $now],
            ]]),
            'timeout'       => 10,
            'ignore_errors' => true,
        ]]));

        if (!$patchResp || isset(json_decode($patchResp ?: '', true)['error'])) {
            vis_fejl('Teknisk fejl', 'Svaret kunne ikke gemmes. Prøv igen.');
            exit;
        }

        vis_tilkendegivelse_bekræftelse($navn, $merged, $datoer, $tf);
        exit;
    }

    vis_tilkendegivelse_svarside($navn, $nuværendeSvar, $datoer, $tf, $token);
    exit;
}

// ══ Begivenhed-flow (eksisterende, uændret) ═══════════════════════════════════
if (!$begivenhedId) {
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

// Hent eventuel extra spørgsmål
$extraSpørgsmaalTekst = '';
$hasExtraSpørgsmaal   = false;
if (isset($bf['extraSpørgsmaal']['mapValue']['fields'])) {
    $eq = $bf['extraSpørgsmaal']['mapValue']['fields'];
    $extraSpørgsmaalTekst = $eq['tekst']['stringValue'] ?? '';
    $hasExtraSpørgsmaal   = $extraSpørgsmaalTekst !== '';
}

// ── POST: registrér svar ──────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $svar = trim($_POST['svar'] ?? '');
    if (!in_array($svar, ['kommer', 'kommer_ikke'], true)) {
        http_response_code(400);
        vis_fejl('Ugyldigt svar', 'Tryk på en af knapperne for at svare.');
        exit;
    }
    $extraSvar = trim($_POST['extra_svar'] ?? '');
    if ($hasExtraSpørgsmaal && !in_array($extraSvar, ['ja', 'nej'], true)) {
        $extraSvar = null; // ikke påkrævet
    }

    $now       = date('Y-m-d\TH:i:s\Z');
    $maskPaths = 'updateMask.fieldPaths=svar&updateMask.fieldPaths=svarTidspunkt';
    $patchFields = [
        'svar'          => ['stringValue' => $svar],
        'svarTidspunkt' => ['timestampValue' => $now],
    ];
    if ($hasExtraSpørgsmaal) {
        $maskPaths .= '&updateMask.fieldPaths=extraSvar';
        $patchFields['extraSvar'] = $extraSvar ? ['stringValue' => $extraSvar] : ['nullValue' => null];
    }

    $patchUrl  = "{$fsBase}/begivenheder/{$begivenhedId}/deltagere/{$memberId}?{$maskPaths}";
    $patchResp = @file_get_contents($patchUrl, false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$fsToken}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => $patchFields]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));

    if (!$patchResp || isset(json_decode($patchResp ?: '', true)['error'])) {
        vis_fejl('Teknisk fejl', 'Svaret kunne ikke gemmes. Prøv igen.');
        exit;
    }

    vis_bekræftelse($navn, $svar, $extraSvar, $extraSpørgsmaalTekst, $bf, $token);
    exit;
}

// ── GET: vis svarside ─────────────────────────────────────────────────────────
$forudvalgt          = trim($_GET['svar'] ?? '');
if (!in_array($forudvalgt, ['kommer', 'kommer_ikke'], true)) $forudvalgt = '';
$nuværendeExtraSvar  = $deltFields['extraSvar']['stringValue'] ?? null;

vis_svarside($navn, $nuvsvar, $forudvalgt, $bf, $token, $hasExtraSpørgsmaal, $extraSpørgsmaalTekst, $nuværendeExtraSvar);

// ── Sidefunktioner ────────────────────────────────────────────────────────────

function vis_svarside(string $navn, ?string $nuvsvar, string $forudvalgt, array $bf, string $token,
                      bool $hasExtra, string $extraTekst, ?string $nuværendeExtra): void {
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
        $label = $nuvsvar === 'kommer' ? 'Du har svaret "Kommer" ✓' : 'Du har svaret "Kommer ikke"';
        $tidlSvarHtml = "<p class=\"curr-svar\">{$label} — du kan ændre det herunder.</p>";
    }

    $extraHtml = '';
    if ($hasExtra) {
        $ekstraTekstEnc = htmlspecialchars($extraTekst);
        $jaClass  = $nuværendeExtra === 'ja'  ? ' selected' : '';
        $nejClass = $nuværendeExtra === 'nej' ? ' selected' : '';
        $extraHtml = <<<EXT
    <div class="extra-blok">
      <p class="spørgsmål" style="margin-bottom:0">{$ekstraTekstEnc}</p>
      <div class="btn-row">
        <label class="bsvar ekstra-ja{$jaClass}">
          <input type="radio" name="extra_svar" value="ja" style="display:none"> Ja
        </label>
        <label class="bsvar ekstra-nej{$nejClass}">
          <input type="radio" name="extra_svar" value="nej" style="display:none"> Nej
        </label>
      </div>
    </div>
EXT;
    }

    $postUrl   = '/s/' . rawurlencode($token);
    $svarBanner = $nuvsvar
        ? ''
        : '<div class="svar-kræves">&#128073; Tryk for at svare — det tager ét sekund</div>';

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
    {$svarBanner}
    <form method="POST" action="{$postUrl}" class="cta-form">
      {$extraHtml}
      <p class="spørgsmål">Kan du komme?</p>
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
<script>
document.querySelectorAll('.ekstra-ja,.ekstra-nej').forEach(function(lbl){
  lbl.addEventListener('click',function(){
    document.querySelectorAll('.ekstra-ja,.ekstra-nej').forEach(function(l){l.classList.remove('selected')});
    lbl.classList.add('selected');
    lbl.querySelector('input').checked=true;
  });
});
</script>
HTML;
    echo '</body></html>';
}

function vis_bekræftelse(string $navn, string $svar, ?string $extraSvar, string $extraSpørgsmaalTekst, array $bf, string $token): void {
    $titel   = htmlspecialchars($bf['titel']['stringValue'] ?? '');
    $navnEnc = htmlspecialchars($navn);
    if ($svar === 'kommer') {
        $ikon = '&#10003;'; $farve = '#1a5c2a'; $tekst = 'Tak! Vi ses til';
    } else {
        $ikon = '&#10005;'; $farve = '#dc2626'; $tekst = 'Ok, du er frameldt';
    }

    $extraHtml = '';
    if ($extraSvar && $extraSpørgsmaalTekst) {
        $tekstEnc = htmlspecialchars($extraSpørgsmaalTekst);
        $svarEnc  = $extraSvar === 'ja' ? 'Ja' : 'Nej';
        $extraHtml = "<p style=\"font-size:14px;color:#4a4a4a\">{$tekstEnc}: <strong>{$svarEnc}</strong></p>";
    }

    $kalenderHtml = '';
    if ($svar === 'kommer') {
        $rawDato   = $bf['dato']['stringValue']        ?? '';
        $rawTid    = $bf['tidspunkt']['stringValue']   ?? '';
        $rawSted   = $bf['sted']['stringValue']        ?? '';
        $rawBesk   = $bf['beskrivelse']['stringValue'] ?? '';
        $rawMøde   = $bf['modetid']['stringValue']     ?? '';
        $typeLabel = ['kamp'=>'Kamp','stævne'=>'Stævne','event'=>'Event','møde'=>'Møde'][$bf['type']['stringValue'] ?? ''] ?? 'Begivenhed';

        $icsUrl = htmlspecialchars('/s/kalender.php?token=' . rawurlencode($token));

        $gcHtml = '';
        if ($rawDato) {
            $gcStart = str_replace('-', '', $rawDato);
            $gcEnd   = $gcStart;
            if ($rawTid && preg_match('/^(\d{1,2}):(\d{2})$/', $rawTid, $tm)) {
                $gcStart .= 'T' . sprintf('%02d%02d00', (int)$tm[1], (int)$tm[2]);
                $gcEnd    = str_replace('-', '', $rawDato) . 'T' . sprintf('%02d%02d00', ((int)$tm[1] + 2) % 24, (int)$tm[2]);
            }
            $gcDesc = '';
            if ($rawMøde) $gcDesc .= "Mødetid: {$rawMøde}\n";
            if ($rawBesk) $gcDesc .= $rawBesk;
            $gcUrl  = htmlspecialchars('https://calendar.google.com/calendar/render?' . http_build_query([
                'action'   => 'TEMPLATE',
                'text'     => "{$typeLabel}: " . ($bf['titel']['stringValue'] ?? ''),
                'dates'    => "{$gcStart}/{$gcEnd}",
                'location' => $rawSted,
                'details'  => $gcDesc,
                'ctz'      => 'Europe/Copenhagen',
            ]));
            $gcHtml = "<a href=\"{$gcUrl}\" class=\"kal-btn kal-google\" target=\"_blank\" rel=\"noopener\">Google Kalender</a>";
        }

        $kalenderHtml = <<<KAL
<div class="kal-boks">
  <p class="kal-label">Tilf&oslash;j til din kalender</p>
  <a href="{$icsUrl}" class="kal-btn">&#128197;&nbsp;iOS / Android / Outlook</a>
  {$gcHtml}
</div>
KAL;
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
    {$extraHtml}
    {$kalenderHtml}
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
body{font-family:system-ui,-apple-system,sans-serif;background:#f4f6f4;min-height:100dvh;display:flex;align-items:flex-start;justify-content:center;padding:16px}
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
.svar-kræves{font-size:13px;font-weight:700;color:#92400e;background:#fef3c7;border:1.5px solid #fcd34d;border-radius:9px;padding:10px 14px;text-align:center}
.cta-form{background:#f8faf8;border:2px solid #1a5c2a;border-radius:13px;padding:16px;display:flex;flex-direction:column;gap:12px}
.spørgsmål{font-size:17px;font-weight:800;text-align:center;color:#1a1a1a}
.btn-row{display:flex;gap:10px}
.bsvar{flex:1;padding:16px 0;border-radius:12px;font-size:16px;font-weight:800;cursor:pointer;border:2px solid transparent;transition:all .15s;letter-spacing:.01em}
.bsvar:active{transform:scale(.97)}
.bsvar.kommer{background:#e8f5ec;color:#1a5c2a;border-color:#1a5c2a}
.bsvar.kommer.selected,.bsvar.kommer:hover{background:#1a5c2a;color:#fff;border-color:#1a5c2a}
.bsvar.ikke{background:#fff5f5;color:#dc2626;border-color:#fecaca}
.bsvar.ikke.selected,.bsvar.ikke:hover{background:#dc2626;color:#fff;border-color:#dc2626}
.ikon-stor{font-size:48px;line-height:1;text-align:center}
.extra-blok{display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:#fff;border-radius:10px;border:1px solid #dde5dd}
.bsvar.ekstra-ja{background:#fff;color:#1a5c2a;border-color:#dde5dd;text-align:center;cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none}
.bsvar.ekstra-ja.selected{background:#1a5c2a;color:#fff;border-color:#1a5c2a}
.bsvar.ekstra-nej{background:#fff;color:#4a4a4a;border-color:#dde5dd;text-align:center;cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none}
.bsvar.ekstra-nej.selected{background:#555;color:#fff;border-color:#555}
.footer{font-size:12px;color:#aaa;text-align:center;margin-top:6px}
.kal-boks{border-top:1px solid #e5e7eb;padding-top:14px;display:flex;flex-direction:column;gap:8px;width:100%}
.kal-label{font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.05em}
.kal-btn{display:block;padding:12px 16px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;text-align:center;background:#e8f5ec;color:#1a5c2a;border:2px solid #1a5c2a;transition:all .15s}
.kal-btn:hover,.kal-btn:active{background:#1a5c2a;color:#fff}
.kal-google{background:#fff;color:#4285f4;border-color:#4285f4}
.kal-google:hover,.kal-google:active{background:#4285f4;color:#fff}
</style>
</head>
<body>
HTML;
}

// ── Tilkendegivelse-sidefunktioner ────────────────────────────────────────────

function vis_tilkendegivelse_svarside(string $navn, array $nuværendeSvar, array $datoer, array $tf, string $token): void {
    $titel   = htmlspecialchars($tf['titel']['stringValue'] ?? '');
    $besked  = htmlspecialchars($tf['besked']['stringValue'] ?? '');
    $navnEnc = htmlspecialchars($navn);
    $postUrl = '/s/' . rawurlencode($token);

    $harSvaret = !empty($nuværendeSvar);
    $tidlSvarHtml = $harSvaret
        ? '<p class="curr-svar">&#10003; Du har allerede svaret — du kan ændre det herunder.</p>'
        : '<div class="svar-kræves">&#128073; Tryk for at svare — det tager ét sekund</div>';

    $beskHtml = $besked
        ? "<p class=\"besk\">{$besked}</p>"
        : '';

    $datoRækker = '';
    foreach ($datoer as $d) {
        $dato     = htmlspecialchars($d['dato']);
        $datoDk   = dato_dk_s($d['dato']);
        $ekstra   = '';
        if ($d['tidspunkt']) $ekstra .= ' kl. ' . htmlspecialchars($d['tidspunkt']);
        if ($d['sted'])      $ekstra .= ' — ' . htmlspecialchars($d['sted']);

        $nuv     = $nuværendeSvar[$d['dato']] ?? '';
        $kanCls  = $nuv === 'kan'      ? ' class="bsvar kan selected"'      : ' class="bsvar kan"';
        $ikkeCls = $nuv === 'kan_ikke' ? ' class="bsvar ikke selected"' : ' class="bsvar ikke"';

        $datoRækker .= <<<ROW
<div class="dato-blok">
  <div class="dato-label">{$datoDk}{$ekstra}</div>
  <div class="btn-row">
    <button type="submit" name="svar[{$dato}]" value="kan" {$kanCls}>Kan &#10003;</button>
    <button type="submit" name="svar[{$dato}]" value="kan_ikke" {$ikkeCls}>Kan ikke</button>
  </div>
</div>
ROW;
    }

    header('Content-Type: text/html; charset=UTF-8');
    echo html_hoved('Tilkendegivelse — Sejs-Svejbæk IF');
    echo <<<HTML
<div class="card">
  <div class="topbar">&#9917; SSIF Tr&aelig;ner</div>
  <div class="body">
    <p class="hilsen">Hej {$navnEnc},</p>
    <h1>{$titel}</h1>
    {$beskHtml}
    {$tidlSvarHtml}
    <form method="POST" action="{$postUrl}" class="cta-form">
      <p class="spørgsmål">Hvornår kan du spille?</p>
      {$datoRækker}
      <button type="submit" class="gem-alle-btn">Gem svar</button>
    </form>
    <p class="footer">Sejs-Svejb&aelig;k IF</p>
  </div>
</div>
<style>
.dato-blok{display:flex;flex-direction:column;gap:8px;padding:12px 0;border-bottom:1px solid #eee}
.dato-blok:last-of-type{border-bottom:none}
.dato-label{font-size:14px;font-weight:700;color:#1a1a1a}
.gem-alle-btn{display:block;width:100%;background:#1a5c2a;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:800;padding:16px;cursor:pointer;margin-top:8px}
.gem-alle-btn:active{transform:scale(.97)}
.bsvar.kan{background:#e8f5ec;color:#1a5c2a;border:2px solid #1a5c2a;border-radius:12px;font-size:15px;font-weight:800;padding:14px 0;cursor:pointer;flex:1;transition:all .15s}
.bsvar.kan.selected,.bsvar.kan:hover{background:#1a5c2a;color:#fff}
.bsvar.ikke{background:#fff5f5;color:#dc2626;border:2px solid #fecaca;border-radius:12px;font-size:15px;font-weight:800;padding:14px 0;cursor:pointer;flex:1;transition:all .15s}
.bsvar.ikke.selected,.bsvar.ikke:hover{background:#dc2626;color:#fff;border-color:#dc2626}
</style>
HTML;
    echo '</body></html>';
}

function vis_tilkendegivelse_bekræftelse(string $navn, array $svar, array $datoer, array $tf): void {
    $titel   = htmlspecialchars($tf['titel']['stringValue'] ?? '');
    $navnEnc = htmlspecialchars($navn);

    $rækkerne = '';
    foreach ($datoer as $d) {
        $datoDk = htmlspecialchars(dato_dk_s($d['dato']));
        $s      = $svar[$d['dato']] ?? '';
        if ($s === 'kan') {
            $ikon = '&#10003;'; $klasse = 'style="color:#1a5c2a;font-weight:700"';
            $tekst = 'Kan';
        } elseif ($s === 'kan_ikke') {
            $ikon = '&#10005;'; $klasse = 'style="color:#dc2626;font-weight:700"';
            $tekst = 'Kan ikke';
        } else {
            $ikon = ''; $klasse = 'style="color:#aaa"'; $tekst = 'Ikke svaret';
        }
        $rækkerne .= "<div class=\"det\"><span>{$datoDk}</span><strong {$klasse}>{$ikon} {$tekst}</strong></div>";
    }

    header('Content-Type: text/html; charset=UTF-8');
    echo html_hoved('Svar registreret — Sejs-Svejbæk IF');
    echo <<<HTML
<div class="card">
  <div class="topbar" style="background:#1a5c2a">&#9917; SSIF Tr&aelig;ner</div>
  <div class="body">
    <div class="ikon-stor" style="color:#1a5c2a">&#10003;</div>
    <h1 style="text-align:center">Tak {$navnEnc}!</h1>
    <p style="font-size:14px;color:#4a4a4a;text-align:center">Dit svar er gemt for {$titel}</p>
    <div class="detaljer">{$rækkerne}</div>
    <p style="font-size:13px;color:#888;text-align:center">Du kan ændre dit svar ved at trykke på linket i mailen igen.</p>
    <p class="footer">Sejs-Svejb&aelig;k IF</p>
  </div>
</div>
HTML;
    echo '</body></html>';
}

function vis_tilkendegivelse_lukket(array $tf): void {
    $titel = htmlspecialchars($tf['titel']['stringValue'] ?? '');
    header('Content-Type: text/html; charset=UTF-8');
    echo html_hoved('Tilkendegivelse lukket — Sejs-Svejbæk IF');
    echo <<<HTML
<div class="card">
  <div class="topbar">&#9917; SSIF Tr&aelig;ner</div>
  <div class="body" style="text-align:center">
    <div class="ikon-stor">&#128197;</div>
    <h1>{$titel}</h1>
    <p style="font-size:14px;color:#4a4a4a">Denne tilkendegivelse er lukket — træneren har allerede fordelt holdene.</p>
    <p class="footer">Sejs-Svejb&aelig;k IF</p>
  </div>
</div>
HTML;
    echo '</body></html>';
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
