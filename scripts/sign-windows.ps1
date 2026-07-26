[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExecutablePath,

    [Parameter()]
    [string]$PfxPath = $env:MEDIA_GATHERER_SIGNING_PFX,

    [Parameter()]
    [System.Security.SecureString]$PfxPassword,

    [Parameter()]
    [string]$SignToolPath = $env:SIGNTOOL_PATH,

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$TimestampUrl = 'https://timestamp.digicert.com'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'La signature Authenticode exige Windows.'
}

if ([string]::IsNullOrWhiteSpace($PfxPath)) {
    throw 'Un fichier PFX est requis via -PfxPath ou MEDIA_GATHERER_SIGNING_PFX.'
}

if ($null -eq $PfxPassword) {
    $environmentPassword = $env:MEDIA_GATHERER_SIGNING_PASSWORD
    if ([string]::IsNullOrWhiteSpace($environmentPassword)) {
        throw 'Un mot de passe PFX est requis via -PfxPassword ou MEDIA_GATHERER_SIGNING_PASSWORD.'
    }
    $PfxPassword = ConvertTo-SecureString -String $environmentPassword -AsPlainText -Force
    $environmentPassword = $null
}

if ($PfxPassword.Length -eq 0) {
    throw 'Le mot de passe PFX ne peut pas etre vide.'
}

$timestampUri = [Uri]$TimestampUrl
if (-not $timestampUri.IsAbsoluteUri -or $timestampUri.Scheme -ne 'https') {
    throw 'TimestampUrl doit etre une URL HTTPS absolue.'
}

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
$resolvedPfx = (Resolve-Path -LiteralPath $PfxPath -ErrorAction Stop).Path

if ([IO.Path]::GetExtension($resolvedExecutable) -ne '.exe') {
    throw 'ExecutablePath doit pointer vers un fichier .exe.'
}

if ([IO.Path]::GetExtension($resolvedPfx) -ne '.pfx') {
    throw 'PfxPath doit pointer vers un fichier .pfx.'
}

if ([string]::IsNullOrWhiteSpace($SignToolPath)) {
    $signToolCommand = Get-Command -Name 'signtool.exe' -CommandType Application -ErrorAction Stop
    $resolvedSignTool = $signToolCommand.Source
} else {
    $resolvedSignTool = (Resolve-Path -LiteralPath $SignToolPath -ErrorAction Stop).Path
}

$passwordPointer = [IntPtr]::Zero
$plainPassword = $null

try {
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($PfxPassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)

    & $resolvedSignTool sign /f $resolvedPfx /p $plainPassword /fd SHA256 /tr $TimestampUrl /td SHA256 $resolvedExecutable
    $signExitCode = $LASTEXITCODE
    if ($signExitCode -ne 0) {
        throw "signtool sign a echoue avec le code $signExitCode."
    }
} finally {
    $plainPassword = $null
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
}

& $resolvedSignTool verify /pa /all $resolvedExecutable
$verifyExitCode = $LASTEXITCODE
if ($verifyExitCode -ne 0) {
    throw "signtool verify a echoue avec le code $verifyExitCode."
}

Write-Host "Signature Windows validee pour $resolvedExecutable."
