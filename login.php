<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$data = http_build_query([
    'Version' => '2',
    'Log_ind_med' => 'mobil',
    'Mobil' => '22391328',
    'Mobil_land_alpha2' => 'DK',
    'Adgangskode' => 'vmna44',
    'Foreningsid' => '1031'
]);

$ch = curl_init('https://www.conventus.dk/dataudv/api/medlemslogin/login.php');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$result = curl_exec($ch);
curl_close($ch);

echo $result;
?>