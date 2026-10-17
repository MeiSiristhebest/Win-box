# Fetch pinned desktop SQLite dependencies (binary JVM assets are ignored by git).
param([string]$Out = "")
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrEmpty($Out)) { $Out = Join-Path $PSScriptRoot "libs" }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$assets = @(
  @{ Path = "org/xerial/sqlite-jdbc/3.53.4.0/sqlite-jdbc-3.53.4.0.jar"; Hash = "BCB1F51E36F940867E83342F9EFBF5968AC44A6BEF4D397BB4AF7B17B45CD2FB" },
  @{ Path = "org/slf4j/slf4j-api/2.0.20/slf4j-api-2.0.20.jar"; Hash = "7E1446499B359675D8AABE6AF2DE86B85E72AE8A2A932C0B40D0E5BA57097439" },
  @{ Path = "org/slf4j/slf4j-simple/2.0.20/slf4j-simple-2.0.20.jar"; Hash = "8E701404786A4F87219D39D4853C86DFE4E86AE99376A39749DF6C08E75022E0" }
)
foreach ($asset in $assets) {
  $target = Join-Path $Out ([IO.Path]::GetFileName($asset.Path))
  if ((Test-Path $target) -and (Get-FileHash $target -Algorithm SHA256).Hash -eq $asset.Hash) { continue }
  $temporary = $target + ".download-" + [guid]::NewGuid().ToString("N")
  try {
    Invoke-WebRequest -UseBasicParsing -Uri ("https://repo.maven.apache.org/maven2/" + $asset.Path) -OutFile $temporary
    if ((Get-FileHash $temporary -Algorithm SHA256).Hash -ne $asset.Hash) { throw "Hash mismatch: $($asset.Path)" }
    Move-Item -Force $temporary $target
  } finally { if (Test-Path $temporary) { Remove-Item $temporary } }
}
