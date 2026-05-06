<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$ch = curl_init('https://www.conventus.dk/dataudv/api/medlemslogin/login.php');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, [
    'Version' => '2',
    'Log_ind_med' => 'email',
    'Email' => $_POST['Email'],
    'Adgangskode' => $_POST['Adgangskode'],
    'Foreningsid' => '1031',
    'Key' => '1284bc2a4f61c8a72da715573b80acdd7043bb4f8c58d2c359ae77c0807964b3'
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$result = curl_exec($ch);
curl_close($ch);

echo $result;
?>
