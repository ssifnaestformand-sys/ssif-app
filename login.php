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
    'Foreningsid' => '1031'
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$result = curl_exec($ch);
curl_close($ch);

echo $result;
?>