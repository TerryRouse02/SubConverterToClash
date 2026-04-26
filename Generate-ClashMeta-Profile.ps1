param(
    [Parameter(Mandatory = $false)]
    [string]$SubscriptionUrl,

    [Parameter(Mandatory = $false)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

Set-StrictMode -Version 2.0

$script:SupportedTypes = @('trojan', 'vless', 'hysteria2', 'hy2')
$script:RegionOrder = @('US', 'HK', 'JP', 'SG', 'TW', 'KR', 'OTHER')
$script:ProbeUrl = 'https://www.gstatic.com/generate_204'
$script:GroupProxy = '🚀 节点选择'
$script:GroupAuto = '⚡ 自动测速'
$script:GroupFallback = '🛟 故障转移'
$script:GroupInfo = 'ℹ️ 订阅信息'
$script:RegionGroupNames = @{
    US = '🇺🇸 美国节点'
    HK = '🇭🇰 香港节点'
    JP = '🇯🇵 日本节点'
    SG = '🇸🇬 新加坡节点'
    TW = '🇹🇼 台湾节点'
    KR = '🇰🇷 韩国节点'
    OTHER = '🌐 其他节点'
}

function Write-Status {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Level,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $prefix = switch ($Level) {
        'OK' { '✅' }
        'INFO' { 'ℹ️' }
        'WARN' { '⚠️' }
        'ERROR' { '❌' }
        default { '•' }
    }

    Write-Host ("{0} [{1}] {2}" -f $prefix, $Level, $Message)
}

function ConvertTo-YamlSingleQuoted {
    param(
        [AllowNull()]
        [string]$Value
    )

    if ($null -eq $Value) {
        return "''"
    }

    return "'" + ($Value -replace "'", "''") + "'"
}

function Normalize-NodeType {
    param(
        [AllowNull()]
        [string]$Type
    )

    if ([string]::IsNullOrWhiteSpace($Type)) {
        return ''
    }

    return $Type.Trim().ToLowerInvariant()
}

function Test-InfoNodeName {
    param(
        [AllowNull()]
        [string]$Name
    )

    if ([string]::IsNullOrWhiteSpace($Name)) {
        return $true
    }

    return [bool]($Name -match '(?i)(刷新订阅|到期|剩余|流量|官网|套餐|订阅|更新|expire|traffic|remaining|renew|website|plan|package)')
}

function Get-RegionCode {
    param(
        [AllowNull()]
        [string]$Name
    )

    if ([string]::IsNullOrWhiteSpace($Name)) {
        return 'OTHER'
    }

    switch -Regex ($Name) {
        '(?i)(香港|港|HK|Hong\s*Kong)' { return 'HK' }
        '(?i)(台湾|台|TW|Taiwan)' { return 'TW' }
        '(?i)(日本|日|JP|Japan)' { return 'JP' }
        '(?i)(美国|美|US|USA|United\s*States)' { return 'US' }
        '(?i)(新加坡|狮城|SG|Singapore)' { return 'SG' }
        '(?i)(韩国|韩|KR|Korea)' { return 'KR' }
        default { return 'OTHER' }
    }
}

function Try-DecodeBase64Text {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $compact = ($Content -replace '\s+', '')
    if ($compact.Length -lt 8) {
        return $null
    }

    try {
        $bytes = [Convert]::FromBase64String($compact)
        return [Text.Encoding]::UTF8.GetString($bytes)
    } catch {
        return $null
    }
}

function Get-SubscriptionContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    Write-Status INFO '正在下载订阅内容...'

    $headers = @{
        'User-Agent' = 'ClashMeta/1.0'
        'Accept' = '*/*'
    }

    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 45 -Headers $headers
    $content = [string]$response.Content

    if ([string]::IsNullOrWhiteSpace($content)) {
        throw '订阅响应为空。'
    }

    return $content
}

function Get-ProxiesBlockLines {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string[]]$Lines
    )

    $inside = $false
    $items = New-Object System.Collections.Generic.List[string]

    foreach ($line in $Lines) {
        if ($line -match '^\s*proxies\s*:\s*$') {
            $inside = $true
            continue
        }

        if ($inside -and $line -match '^\S[^\r\n]*:\s*') {
            break
        }

        if ($inside) {
            if ($line -match '^\s*$') {
                continue
            }

            $items.Add($line)
        }
    }

    return $items.ToArray()
}

function Parse-InlineJsonProxyLine {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Line,

        [Parameter(Mandatory = $true)]
        [int]$SourceLineNumber
    )

    if ($Line -notmatch '^\s*-\s*(\{.*\})\s*$') {
        return $null
    }

    $json = $Matches[1]

    try {
        $node = $json | ConvertFrom-Json
    } catch {
        throw ("第 {0} 行代理 JSON 解析失败：{1}" -f $SourceLineNumber, $_.Exception.Message)
    }

    $name = [string]$node.name
    $type = Normalize-NodeType ([string]$node.type)

    if ([string]::IsNullOrWhiteSpace($name)) {
        throw ("第 {0} 行代理节点缺少 name 字段。" -f $SourceLineNumber)
    }

    return [pscustomobject]@{
        Name = $name
        Type = $type
        Region = Get-RegionCode $name
        IsInfo = Test-InfoNodeName $name
        SourceLineNumber = $SourceLineNumber
        RawLine = $Line.TrimEnd()
    }
}

function Get-ProxyRecords {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $working = $Content
    if ($working -notmatch '(?m)^\s*proxies\s*:') {
        $decoded = Try-DecodeBase64Text $working
        if ($decoded -and $decoded -match '(?m)^\s*proxies\s*:') {
            Write-Status INFO '检测到 Base64 包装的 Clash YAML 内容。'
            $working = $decoded
        } elseif ($decoded -and $decoded -match '(?m)^(vmess|vless|trojan|ss|ssr|hysteria2|hy2|tuic)://') {
            throw '这个订阅是 URI 列表，不是 Clash YAML。请在 Sub-Store 使用 target=ClashMeta 导出。'
        } else {
            throw '订阅内容没有顶层 proxies: 段。'
        }
    }

    $lines = $working -split "`r?`n"
    $proxyLines = Get-ProxiesBlockLines $lines
    if ($proxyLines.Count -eq 0) {
        throw 'proxies: 段为空，或无法读取。'
    }

    $records = New-Object System.Collections.Generic.List[object]
    $sourceLineNumber = 0
    foreach ($line in $lines) {
        $sourceLineNumber++
        $record = Parse-InlineJsonProxyLine -Line $line -SourceLineNumber $sourceLineNumber
        if ($null -ne $record) {
            $records.Add($record)
        }
    }

    if ($records.Count -eq 0) {
        throw '没有找到行内 JSON 节点。本脚本当前支持 Sub-Store ClashMeta YAML，例如：- {"name":"...","type":"..."}'
    }

    return $records.ToArray()
}

function Add-ProxyList {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Lines,

        [Parameter(Mandatory = $true)]
        [string[]]$Names,

        [Parameter(Mandatory = $false)]
        [switch]$AllowEmptyDirect
    )

    if ($Names.Count -eq 0 -and $AllowEmptyDirect) {
        $Names = @('DIRECT')
    }

    foreach ($name in $Names) {
        $Lines.Add(('      - {0}' -f (ConvertTo-YamlSingleQuoted $name)))
    }
}

function Add-SelectGroup {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Lines,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string[]]$Names,

        [Parameter(Mandatory = $false)]
        [switch]$AllowEmptyDirect
    )

    $Lines.Add(('  - name: {0}' -f (ConvertTo-YamlSingleQuoted $Name)))
    $Lines.Add('    type: select')
    $Lines.Add('    proxies:')
    Add-ProxyList -Lines $Lines -Names $Names -AllowEmptyDirect:$AllowEmptyDirect
}

function Add-HealthGroup {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Lines,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Type,

        [Parameter(Mandatory = $true)]
        [string[]]$Names
    )

    $Lines.Add(('  - name: {0}' -f (ConvertTo-YamlSingleQuoted $Name)))
    $Lines.Add(('    type: {0}' -f $Type))
    $Lines.Add(('    url: {0}' -f (ConvertTo-YamlSingleQuoted $script:ProbeUrl)))
    $Lines.Add('    interval: 300')
    $Lines.Add('    tolerance: 50')
    $Lines.Add('    lazy: true')
    $Lines.Add('    proxies:')
    Add-ProxyList -Lines $Lines -Names $Names -AllowEmptyDirect
}

function Get-FixedProfileLines {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Records,

        [Parameter(Mandatory = $true)]
        [object[]]$OutputProxyRecords,

        [Parameter(Mandatory = $true)]
        [object[]]$MainProxyRecords,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$InfoRecords
    )

    $lines = New-Object System.Collections.Generic.List[string]

    $lines.Add('# 由 Generate-ClashMeta-Profile.ps1 自动生成')
    $lines.Add('# 目标客户端：Mihomo / Clash.Meta / FlClash')
    $lines.Add('mixed-port: 7890')
    $lines.Add('allow-lan: false')
    $lines.Add('mode: rule')
    $lines.Add('log-level: info')
    $lines.Add('ipv6: false')
    $lines.Add('unified-delay: true')
    $lines.Add('tcp-concurrent: true')
    $lines.Add('')
    $lines.Add('proxies:')

    foreach ($record in $OutputProxyRecords) {
        $lines.Add($record.RawLine)
    }

    $mainNames = @($MainProxyRecords | ForEach-Object { [string]$_.Name })
    $infoNames = @($InfoRecords | ForEach-Object { [string]$_.Name })

    $regionNames = @{}
    foreach ($region in $script:RegionOrder) {
        $regionNames[$region] = @($MainProxyRecords | Where-Object { $_.Region -eq $region } | ForEach-Object { [string]$_.Name })
    }

    $activeRegions = @($script:RegionOrder | Where-Object { $regionNames[$_].Count -gt 0 })
    $activeRegionGroupNames = @($activeRegions | ForEach-Object { $script:RegionGroupNames[$_] })
    $proxyGroupEntries = @($script:GroupAuto, $script:GroupFallback) + $activeRegionGroupNames + @('DIRECT')

    $lines.Add('')
    $lines.Add('proxy-groups:')
    Add-SelectGroup -Lines $lines -Name $script:GroupProxy -Names $proxyGroupEntries
    Add-HealthGroup -Lines $lines -Name $script:GroupAuto -Type 'url-test' -Names $mainNames
    Add-HealthGroup -Lines $lines -Name $script:GroupFallback -Type 'fallback' -Names $mainNames

    foreach ($region in $activeRegions) {
        Add-SelectGroup -Lines $lines -Name $script:RegionGroupNames[$region] -Names $regionNames[$region]
    }

    Add-SelectGroup -Lines $lines -Name $script:GroupInfo -Names $infoNames -AllowEmptyDirect

    $lines.Add('')
    $lines.Add('rules:')
    $rules = @(
        'DOMAIN-SUFFIX,local,DIRECT',
        'DOMAIN-SUFFIX,localhost,DIRECT',
        'DOMAIN-SUFFIX,lan,DIRECT',
        'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
        'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
        'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
        'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
        'IP-CIDR,169.254.0.0/16,DIRECT,no-resolve',
        'IP-CIDR,224.0.0.0/4,DIRECT,no-resolve',
        'IP-CIDR6,::1/128,DIRECT,no-resolve',
        'IP-CIDR6,fc00::/7,DIRECT,no-resolve',
        'IP-CIDR6,fe80::/10,DIRECT,no-resolve',
        'DOMAIN-SUFFIX,cn,DIRECT',
        'DOMAIN-SUFFIX,中国,DIRECT',
        'DOMAIN-SUFFIX,公司,DIRECT',
        'DOMAIN-SUFFIX,网络,DIRECT',
        'DOMAIN-SUFFIX,gov.cn,DIRECT',
        'DOMAIN-SUFFIX,edu.cn,DIRECT',
        'DOMAIN-SUFFIX,baidu.com,DIRECT',
        'DOMAIN-SUFFIX,bdstatic.com,DIRECT',
        'DOMAIN-SUFFIX,qq.com,DIRECT',
        'DOMAIN-SUFFIX,weixin.qq.com,DIRECT',
        'DOMAIN-SUFFIX,gtimg.com,DIRECT',
        'DOMAIN-SUFFIX,alicdn.com,DIRECT',
        'DOMAIN-SUFFIX,aliyun.com,DIRECT',
        'DOMAIN-SUFFIX,taobao.com,DIRECT',
        'DOMAIN-SUFFIX,tmall.com,DIRECT',
        'DOMAIN-SUFFIX,jd.com,DIRECT',
        'DOMAIN-SUFFIX,360buyimg.com,DIRECT',
        'DOMAIN-SUFFIX,bilibili.com,DIRECT',
        'DOMAIN-SUFFIX,biliapi.net,DIRECT',
        'DOMAIN-SUFFIX,byteimg.com,DIRECT',
        'DOMAIN-SUFFIX,bytedance.com,DIRECT',
        'DOMAIN-SUFFIX,douyin.com,DIRECT',
        'DOMAIN-SUFFIX,weibo.com,DIRECT',
        'DOMAIN-SUFFIX,zhihu.com,DIRECT',
        'DOMAIN-SUFFIX,163.com,DIRECT',
        'DOMAIN-SUFFIX,126.com,DIRECT',
        'DOMAIN-SUFFIX,netease.com,DIRECT',
        'DOMAIN-SUFFIX,sina.com.cn,DIRECT',
        'DOMAIN-SUFFIX,xiaomi.com,DIRECT',
        'DOMAIN-SUFFIX,huawei.com,DIRECT',
        'GEOSITE,private,DIRECT',
        'GEOSITE,cn,DIRECT',
        'GEOIP,private,DIRECT,no-resolve',
        'GEOIP,CN,DIRECT',
        ('MATCH,{0}' -f $script:GroupProxy)
    )

    foreach ($rule in $rules) {
        $lines.Add(('  - {0}' -f $rule))
    }

    return $lines.ToArray()
}

function Test-GeneratedProfile {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$MainProxyRecords,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$InfoRecords,

        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string[]]$ProfileLines
    )

    $text = $ProfileLines -join "`n"
    foreach ($required in @('proxies:', 'proxy-groups:', 'rules:', ('MATCH,{0}' -f $script:GroupProxy))) {
        if ($text -notmatch [regex]::Escape($required)) {
            throw ("生成配置缺少必要内容：{0}" -f $required)
        }
    }

    if ($MainProxyRecords.Count -eq 0) {
        throw '过滤信息节点和不支持协议后，没有剩余可用代理节点。'
    }

    $names = New-Object System.Collections.Generic.HashSet[string]
    foreach ($record in @($MainProxyRecords + $InfoRecords)) {
        [void]$names.Add([string]$record.Name)
    }

    foreach ($record in $MainProxyRecords) {
        if (-not $names.Contains([string]$record.Name)) {
            throw ("内部校验失败，代理节点不存在：{0}" -f $record.Name)
        }
    }
}

function Show-Summary {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Records,

        [Parameter(Mandatory = $true)]
        [object[]]$MainProxyRecords,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$InfoRecords,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$UnsupportedRecords,

        [Parameter(Mandatory = $true)]
        [string]$ResolvedOutputPath
    )

    Write-Host ''
    Write-Status OK '已生成修复后的 ClashMeta 配置。'
    Write-Host ('  📦 源节点总数：        {0}' -f $Records.Count)
    Write-Host ('  🚀 可用代理节点：      {0}' -f $MainProxyRecords.Count)
    Write-Host ('  ℹ️ 订阅信息节点：      {0}' -f $InfoRecords.Count)
    Write-Host ('  ⚠️ 已跳过不兼容节点：  {0}' -f $UnsupportedRecords.Count)

    foreach ($region in $script:RegionOrder) {
        $count = @($MainProxyRecords | Where-Object { $_.Region -eq $region }).Count
        if ($count -gt 0) {
            Write-Host ('  {0,-12}： {1}' -f $script:RegionGroupNames[$region], $count)
        }
    }

    Write-Host ('  📄 输出文件：          {0}' -f $ResolvedOutputPath)
    Write-Host ''

    if ($UnsupportedRecords.Count -gt 0) {
        $types = $UnsupportedRecords | Group-Object Type | Sort-Object Name | ForEach-Object { '{0}={1}' -f $_.Name, $_.Count }
        Write-Status WARN ("已跳过 Meta 目标不支持的节点类型：{0}" -f ($types -join ', '))
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($SubscriptionUrl)) {
        $SubscriptionUrl = Read-Host '🔗 订阅链接'
    }

    if ([string]::IsNullOrWhiteSpace($SubscriptionUrl)) {
        throw '没有输入订阅链接。'
    }

    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        $OutputPath = Join-Path $scriptDir 'Output\ClashMeta_Fixed.yaml'
    } elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
        $OutputPath = Join-Path $scriptDir $OutputPath
    }

    $content = Get-SubscriptionContent -Url $SubscriptionUrl
    $records = @(Get-ProxyRecords -Content $content)

    $supportedRecords = @($records | Where-Object { $script:SupportedTypes -contains $_.Type })
    $unsupportedRecords = @($records | Where-Object { -not ($script:SupportedTypes -contains $_.Type) })
    $infoRecords = @($supportedRecords | Where-Object { $_.IsInfo })
    $mainProxyRecords = @($supportedRecords | Where-Object { -not $_.IsInfo })
    $outputProxyRecords = @($supportedRecords)

    $duplicateNames = @($outputProxyRecords | Group-Object Name | Where-Object { $_.Count -gt 1 })
    if ($duplicateNames.Count -gt 0) {
        $dupes = $duplicateNames | Select-Object -First 5 | ForEach-Object { $_.Name }
        throw ("发现重复节点名称，请先修正订阅。示例：{0}" -f ($dupes -join ', '))
    }

    $profileLines = Get-FixedProfileLines -Records $records -OutputProxyRecords $outputProxyRecords -MainProxyRecords $mainProxyRecords -InfoRecords $infoRecords
    Test-GeneratedProfile -MainProxyRecords $mainProxyRecords -InfoRecords $infoRecords -ProfileLines $profileLines

    $outputDir = Split-Path -Parent $OutputPath
    if (-not (Test-Path -LiteralPath $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir | Out-Null
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
    [System.IO.File]::WriteAllText($OutputPath, (($profileLines -join "`r`n") + "`r`n"), $utf8NoBom)

    Show-Summary -Records $records -MainProxyRecords $mainProxyRecords -InfoRecords $infoRecords -UnsupportedRecords $unsupportedRecords -ResolvedOutputPath $OutputPath
    exit 0
} catch {
    Write-Host ''
    Write-Status ERROR $_.Exception.Message
    if ($env:CLASH_PROFILE_DEBUG -eq '1') {
        Write-Host $_.ScriptStackTrace
    }
    Write-Host ''
    exit 1
}
