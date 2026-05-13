<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

// Hent API-nøgle fra miljøvariabel (SetEnv i .htaccess, injiceret af deploy-pipeline)
$apiKey = getenv('CONVENTUS_KEY');
if (!$apiKey) {
    foreach ([__DIR__ . '/.env', __DIR__ . '/../.env'] as $path) {
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

$ch = curl_init('https://www.conventus.dk/dataudv/api/medlemslogin/login.php');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, [
    'Version'      => '2',
    'Log_ind_med'  => 'email',
    'Email'        => $_POST['Email'],
    'Adgangskode'  => $_POST['Adgangskode'],
    'Foreningsid'  => '1031',
    'Key'          => $apiKey,
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$result = curl_exec($ch);
curl_close($ch);

echo $result;
?>
