# Renvoie la clé GitHub utilisée pour publier.
# La première fois, elle est demandée puis enregistrée chiffrée par Windows (lisible seulement par ton compte).
# Avec -Reset, la clé enregistrée est oubliée et redemandée.
param([switch]$Reset)

$dir = Join-Path $env:APPDATA 'radhes-launcher-publish'
$file = Join-Path $dir 'cle-github.txt'

if ($Reset -and (Test-Path $file)) { Remove-Item $file -Force }

if (-not (Test-Path $file)) {
    [Console]::Error.WriteLine('Colle ta cle GitHub (clic droit pour coller), puis appuie sur Entree :')
    $secure = Read-Host -AsSecureString
    if ($secure.Length -eq 0) { exit 1 }
    New-Item -ItemType Directory -Force $dir | Out-Null
    $secure | ConvertFrom-SecureString | Set-Content $file
}

$secure = Get-Content $file | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
