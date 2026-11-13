#Requires -Version 5.1
<#
.SYNOPSIS
  Starts the Subway signature kiosk on Windows: both Node servers and one
  full-screen browser per display, and keeps them running.

.DESCRIPTION
  Runs at user logon (see install-kiosk.ps1). Offline: uses the portable Node
  in .\node and the prebuilt .output folders. Every 5 seconds it restarts any
  server or browser window that has exited. Create a file named STOP in this
  folder (stop-kiosk.cmd does it) to shut everything down.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$Root = $PSScriptRoot
$Node = Join-Path $Root 'node\node.exe'
$DataDir = Join-Path $Root 'data'
$LogDir = Join-Path $Root 'logs'
$ProfileDir = Join-Path $Root 'profiles'
$StopFile = Join-Path $Root 'STOP'
$BootPage = Join-Path $Root 'boot.html'

New-Item -ItemType Directory -Force -Path $DataDir, $LogDir, $ProfileDir | Out-Null

function Write-KioskLog([string] $Message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path (Join-Path $LogDir 'kiosk.log') -Value $line -Encoding UTF8
}

# --- Single instance -----------------------------------------------------------
$mutex = New-Object System.Threading.Mutex($false, 'Local\SubwaySignatureKiosk')
if (-not $mutex.WaitOne(0)) {
  Write-KioskLog 'Another start-kiosk.ps1 is already running; exiting.'
  exit 0
}

try {
  # --- Configuration -----------------------------------------------------------
  $config = Get-Content -Path (Join-Path $Root 'kiosk.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($required in @('host', 'signaturePort', 'signatureCountdownSeconds',
      'signatureIdleTimeoutSeconds', 'browser', 'signatureScreen', 'counterScreen', 'forceDeviceScaleFactor')) {
    if (-not ($config.PSObject.Properties.Name -contains $required)) {
      throw "kiosk.json is missing '$required'."
    }
  }
  if (-not (Test-Path $Node)) { throw "Portable Node not found at $Node. Rebuild the package with package-kiosk.sh." }
  if (Test-Path $StopFile) { Remove-Item $StopFile -Force }

  # One server serves both screens: the touch kiosk at / and the LED counter at /counter.
  if ($config.PSObject.Properties.Name -contains 'counterPort') {
    Write-KioskLog "kiosk.json 'counterPort' is obsolete and ignored: the counter is served at /counter."
  }
  $signatureUrl = 'http://127.0.0.1:{0}/' -f $config.signaturePort
  $counterUrl = 'http://127.0.0.1:{0}/counter' -f $config.signaturePort

  # --- Node servers --------------------------------------------------------------
  $servers = @(
    @{
      Name = 'assinatura'
      Dir = Join-Path $Root 'assinatura'
      Env = @{
        PORT = [string] $config.signaturePort
        SIGNATURE_DB_PATH = Join-Path $DataDir 'signatures.sqlite'
        NUXT_PUBLIC_SIGNATURE_COUNTDOWN_SECONDS = [string] $config.signatureCountdownSeconds
        NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS = [string] $config.signatureIdleTimeoutSeconds
      }
      Process = $null
    }
  )

  function Stop-OwnNodeProcesses {
    # Only node.exe from this kiosk folder; never other Node apps on the PC.
    Get-Process -Name node -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $Node } |
      ForEach-Object {
        Write-KioskLog "Stopping leftover node.exe (pid $($_.Id))."
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      }
  }

  function Start-KioskServer($Server) {
    $entry = Join-Path $Server.Dir '.output\server\index.mjs'
    if (-not (Test-Path $entry)) { throw "Build not found: $entry" }
    $log = Join-Path $LogDir ($Server.Name + '.log')

    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $env:ComSpec
    # cmd keeps the redirection; it exits as soon as node.exe exits.
    $info.Arguments = '/d /c ""{0}" "{1}" >> "{2}" 2>&1"' -f $Node, $entry, $log
    $info.WorkingDirectory = $Server.Dir
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.EnvironmentVariables['NODE_ENV'] = 'production'
    $info.EnvironmentVariables['HOST'] = [string] $config.host
    foreach ($key in $Server.Env.Keys) { $info.EnvironmentVariables[$key] = $Server.Env[$key] }

    $Server.Process = [System.Diagnostics.Process]::Start($info)
    Write-KioskLog "Started $($Server.Name) (pid $($Server.Process.Id))."
  }

  # --- Browser -------------------------------------------------------------------
  function Find-Browser {
    $edge = @(
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    $chrome = @(
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    switch ([string] $config.browser) {
      'edge' { if ($edge) { return @{ Path = $edge; IsEdge = $true } } }
      'chrome' { if ($chrome) { return @{ Path = $chrome; IsEdge = $false } } }
      default {
        if ($chrome) { return @{ Path = $chrome; IsEdge = $false } }
        if ($edge) { return @{ Path = $edge; IsEdge = $true } }
      }
    }
    throw "No browser found for setting '$($config.browser)'. Install Edge or Chrome."
  }

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -Namespace KioskNative -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
  # Physical pixel bounds, independent of the Windows scaling setting.
  [void] [KioskNative.Dpi]::SetProcessDPIAware()

  function Get-KioskScreens {
    $screens = @([System.Windows.Forms.Screen]::AllScreens)
    $i = 0
    foreach ($screen in $screens) {
      Write-KioskLog ("Display {0}: {1} {2}x{3} at {4},{5} primary={6}" -f $i, $screen.DeviceName,
        $screen.Bounds.Width, $screen.Bounds.Height, $screen.Bounds.X, $screen.Bounds.Y, $screen.Primary)
      $i++
    }

    # A number in kiosk.json pins a display index (see kiosk.log); 'auto' detects it.
    function Select-Screen($Setting) {
      if ([string] $Setting -ne 'auto') {
        $index = [int] $Setting
        if ($index -ge 0 -and $index -lt $screens.Count) { return $index }
        Write-KioskLog "Configured display index $Setting does not exist; using auto."
      }
      return -1
    }

    $signatureIndex = Select-Screen $config.signatureScreen
    if ($signatureIndex -lt 0) {
      # The signature totem is the portrait (taller than wide) display.
      $signatureIndex = 0
      for ($j = 0; $j -lt $screens.Count; $j++) {
        if ($screens[$j].Bounds.Height -gt $screens[$j].Bounds.Width) { $signatureIndex = $j; break }
      }
    }

    $counterIndex = Select-Screen $config.counterScreen
    if ($counterIndex -lt 0) {
      $counterIndex = -1
      for ($j = 0; $j -lt $screens.Count; $j++) {
        if ($j -ne $signatureIndex) { $counterIndex = $j; break }
      }
    }

    return @{
      Signature = $screens[$signatureIndex].Bounds
      Counter = if ($counterIndex -ge 0) { $screens[$counterIndex].Bounds } else { $null }
    }
  }

  function Get-BrowserProcessCount([string] $ProfilePath) {
    $needle = $ProfilePath.ToLowerInvariant()
    $found = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe' OR Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) }
    return @($found).Count
  }

  function Stop-BrowserProfile([string] $ProfilePath) {
    $needle = $ProfilePath.ToLowerInvariant()
    Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe' OR Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }

  function Start-KioskBrowser($Browser, [string] $Name, [string] $TargetUrl, $Bounds) {
    $profilePath = Join-Path $ProfileDir $Name
    $bootUrl = (New-Object System.Uri($BootPage)).AbsoluteUri + '?target=' + [System.Uri]::EscapeDataString($TargetUrl)
    $arguments = @(
      "--user-data-dir=`"$profilePath`"",
      "--window-position=$($Bounds.X),$($Bounds.Y)",
      "--window-size=$($Bounds.Width),$($Bounds.Height)",
      "--force-device-scale-factor=$($config.forceDeviceScaleFactor)",
      '--kiosk',
      '--no-first-run',
      '--no-default-browser-check',
      '--noerrdialogs',
      '--disable-session-crashed-bubble',
      '--disable-infobars',
      '--disable-pinch',
      '--overscroll-history-navigation=0',
      '--disable-features=Translate,TranslateUI',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding'
    )
    if ($Browser.IsEdge) { $arguments += '--edge-kiosk-type=fullscreen' }
    $arguments += "`"$bootUrl`""

    Start-Process -FilePath $Browser.Path -ArgumentList $arguments | Out-Null
    Write-KioskLog "Opened $Name on display at $($Bounds.X),$($Bounds.Y) ($($Bounds.Width)x$($Bounds.Height))."
  }

  # --- Start ---------------------------------------------------------------------
  Write-KioskLog '--- Kiosk starting ---'
  Stop-OwnNodeProcesses
  foreach ($server in $servers) { Start-KioskServer $server }

  $browser = Find-Browser
  Write-KioskLog "Browser: $($browser.Path)"
  $layout = Get-KioskScreens

  $windows = @(@{ Name = 'assinatura'; Url = $signatureUrl; Bounds = $layout.Signature })
  if ($null -ne $layout.Counter) {
    $windows += @{ Name = 'contador'; Url = $counterUrl; Bounds = $layout.Counter }
  } else {
    Write-KioskLog 'Only one display found: the counter window is not opened.'
  }

  foreach ($window in $windows) {
    Stop-BrowserProfile (Join-Path $ProfileDir $window.Name)
    Start-KioskBrowser $browser $window.Name $window.Url $window.Bounds
  }

  # --- Watchdog ------------------------------------------------------------------
  $restarts = @{}
  while (-not (Test-Path $StopFile)) {
    Start-Sleep -Seconds 5

    foreach ($server in $servers) {
      if ($server.Process.HasExited) {
        Write-KioskLog "$($server.Name) exited with code $($server.Process.ExitCode); restarting."
        Start-Sleep -Seconds 2
        Start-KioskServer $server
      }
    }

    foreach ($window in $windows) {
      $profilePath = Join-Path $ProfileDir $window.Name
      if ((Get-BrowserProcessCount $profilePath) -eq 0) {
        $count = 1 + [int] $restarts[$window.Name]
        $restarts[$window.Name] = $count
        Write-KioskLog "Browser window '$($window.Name)' is closed; reopening (#$count)."
        Start-KioskBrowser $browser $window.Name $window.Url $window.Bounds
      }
    }
  }

  # --- Stop ----------------------------------------------------------------------
  Write-KioskLog 'STOP file found; shutting down.'
  foreach ($window in $windows) { Stop-BrowserProfile (Join-Path $ProfileDir $window.Name) }
  foreach ($server in $servers) {
    if (-not $server.Process.HasExited) { Stop-Process -Id $server.Process.Id -Force -ErrorAction SilentlyContinue }
  }
  Stop-OwnNodeProcesses
  Remove-Item $StopFile -Force -ErrorAction SilentlyContinue
  Write-KioskLog '--- Kiosk stopped ---'
}
catch {
  Write-KioskLog ("FATAL: {0}" -f $_.Exception.Message)
  throw
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
