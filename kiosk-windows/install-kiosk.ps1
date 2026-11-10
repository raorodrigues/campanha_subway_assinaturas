#Requires -Version 5.1
<#
.SYNOPSIS
  One-time Windows setup for the Subway signature kiosk. Run as Administrator.

.DESCRIPTION
  - Starts the kiosk automatically when -User logs on (scheduled task).
  - Keeps the screens and PC awake.
  - Disables edge swipes and toast notifications.
  - Applies Edge/Chrome policies (no translate bar, sign-in, password or autofill prompts).
  - Gives -User write access to the data and logs folders.
  Everything is offline. Re-running it is safe.

.PARAMETER User
  Windows account that logs on automatically at the kiosk. Default: current user.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\kiosk\install-kiosk.ps1 -User totem
#>
[CmdletBinding()]
param(
  [string] $User = $env:USERNAME
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$Root = $PSScriptRoot
$TaskName = 'Subway Kiosk'

function Write-Step([string] $Message) { Write-Host "==> $Message" -ForegroundColor Green }
function Write-Note([string] $Message) { Write-Host "    $Message" -ForegroundColor Yellow }

function Set-RegistryDword([string] $Path, [string] $Name, [int] $Value) {
  if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
  New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType DWord -Force | Out-Null
}

# --- Preconditions ---------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Execute este script como Administrador (botao direito > Executar como administrador).'
}

foreach ($required in @('node\node.exe', 'assinatura\.output\server\index.mjs',
    'contador-assinaturas\.output\server\index.mjs', 'start-kiosk.ps1', 'kiosk.json', 'boot.html')) {
  if (-not (Test-Path (Join-Path $Root $required))) { throw "Arquivo ausente no pacote: $required" }
}

$riskyFolders = @($env:OneDrive, [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments')) |
  Where-Object { $_ }
foreach ($folder in $riskyFolders) {
  if ($Root.StartsWith($folder, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Note "ATENCAO: o quiosque esta em '$Root'. OneDrive/antivirus podem travar o banco SQLite. Use C:\kiosk."
  }
}

$nodeVersion = & (Join-Path $Root 'node\node.exe') --version
Write-Step "Node portatil: $nodeVersion"

# --- Folders and permissions -----------------------------------------------------
Write-Step "Pastas data/logs/profiles com escrita para '$User'"
foreach ($name in @('data', 'logs', 'profiles')) {
  $path = Join-Path $Root $name
  New-Item -ItemType Directory -Force -Path $path | Out-Null
  & icacls.exe $path /grant "${User}:(OI)(CI)M" /T /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls falhou para $path (usuario '$User' existe?)" }
}

# --- Autostart at logon ----------------------------------------------------------
Write-Step "Tarefa agendada '$TaskName' ao entrar com '$User'"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f (Join-Path $Root 'start-kiosk.ps1')) `
  -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskPrincipal `
  -Settings $settings -Force | Out-Null

# --- Power: never sleep or turn the screens off ----------------------------------
Write-Step 'Energia: tela e PC sempre ligados'
foreach ($setting in @('monitor-timeout-ac', 'monitor-timeout-dc', 'standby-timeout-ac',
    'standby-timeout-dc', 'hibernate-timeout-ac', 'hibernate-timeout-dc')) {
  & powercfg.exe /change $setting 0
}

# --- Touch edge swipes (works on Pro/Enterprise; harmless elsewhere) --------------
Write-Step 'Desativando gestos de borda da tela'
Set-RegistryDword 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI' 'AllowEdgeSwipe' 0

# --- Notifications (applies to the account running this script) -----------------
if ($User -eq $env:USERNAME) {
  Write-Step 'Desativando notificacoes do Windows para este usuario'
  Set-RegistryDword 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' 'ToastEnabled' 0
} else {
  Write-Note "Notificacoes: desative manualmente entrando como '$User' (Configuracoes > Sistema > Notificacoes)."
}

# --- Browser policies -------------------------------------------------------------
Write-Step 'Politicas do Edge e do Chrome'
$edgePolicies = @{
  TranslateEnabled = 0
  HideFirstRunExperience = 1
  PasswordManagerEnabled = 0
  AutofillAddressEnabled = 0
  AutofillCreditCardEnabled = 0
  BrowserSignin = 0
  SyncDisabled = 1
  HubsSidebarEnabled = 0
  StartupBoostEnabled = 0
  BackgroundModeEnabled = 0
}
foreach ($name in $edgePolicies.Keys) {
  Set-RegistryDword 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' $name $edgePolicies[$name]
}
$chromePolicies = @{
  TranslateEnabled = 0
  PasswordManagerEnabled = 0
  AutofillAddressEnabled = 0
  AutofillCreditCardEnabled = 0
  BrowserSignin = 0
  SyncDisabled = 1
  BackgroundModeEnabled = 0
}
foreach ($name in $chromePolicies.Keys) {
  Set-RegistryDword 'HKLM:\SOFTWARE\Policies\Google\Chrome' $name $chromePolicies[$name]
}

Write-Step 'Concluido.'
Write-Note 'Proximos passos manuais: kiosk-windows README, secao "Checklist do equipamento".'
Write-Note "Teste agora: execute start-kiosk.cmd como '$User' ou reinicie o PC."
