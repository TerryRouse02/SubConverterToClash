/*
 * Sub-Store ClashMeta Fixer
 *
 * Purpose:
 * - Rebuild a ClashMeta YAML response that only contains proxies into a complete profile.
 * - Add proxy-groups and rules for Mihomo / Clash.Meta / FlClash.
 *
 * Important:
 * - This script must run in a Sub-Store stage that exposes final response content as $content.
 * - If it is placed under "Subscription Edit -> Node Operations -> Script Operation",
 *   it can only return proxy nodes and cannot add proxy-groups or rules.
 */

const SUPPORTED_TYPES = new Set(["trojan", "vless", "hysteria2", "hy2"]);
const REGION_ORDER = ["US", "HK", "JP", "SG", "TW", "KR", "OTHER"];
const RULE_PROFILE = "Hybrid"; // Stable | Hybrid | Rich
const PROBE_URL = "https://cp.cloudflare.com/generate_204";

const GROUP_PROXY = "🚀 节点选择";
const GROUP_MANUAL = "🧭 手动选择";
const GROUP_AUTO = "⚡ 自动测速";
const GROUP_FALLBACK = "🛟 故障转移";
const GROUP_INFO = "ℹ️ 订阅信息";

const REGION_GROUP_NAMES = {
  US: "🇺🇸 美国节点",
  HK: "🇭🇰 香港节点",
  JP: "🇯🇵 日本节点",
  SG: "🇸🇬 新加坡节点",
  TW: "🇹🇼 台湾节点",
  KR: "🇰🇷 韩国节点",
  OTHER: "🌐 其他节点",
};

function yamlQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cleanProxy(value) {
  if (Array.isArray(value)) {
    return value.map(cleanProxy);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const output = {};
  for (const [key, val] of Object.entries(value)) {
    if (key.startsWith("_")) continue;
    if (typeof val === "undefined" || typeof val === "function") continue;
    output[key] = cleanProxy(val);
  }
  return output;
}

function normalizeType(type) {
  return String(type || "").trim().toLowerCase();
}

function isInfoNodeName(name) {
  return /刷新订阅|到期|剩余|流量|官网|套餐|订阅|更新|expire|traffic|remaining|renew|website|plan|package/i.test(
    String(name || "")
  );
}

function regionOf(name) {
  const text = String(name || "");
  if (/(香港|港|HK|Hong\s*Kong)/i.test(text)) return "HK";
  if (/(台湾|台|TW|Taiwan)/i.test(text)) return "TW";
  if (/(日本|日|JP|Japan)/i.test(text)) return "JP";
  if (/(美国|美|US|USA|United\s*States)/i.test(text)) return "US";
  if (/(新加坡|狮城|SG|Singapore)/i.test(text)) return "SG";
  if (/(韩国|韩|KR|Korea)/i.test(text)) return "KR";
  return "OTHER";
}

function getYamlApi() {
  const utils = typeof ProxyUtils !== "undefined" ? ProxyUtils : undefined;
  if (utils && utils.yaml) return utils.yaml;
  if (typeof yaml !== "undefined") return yaml;
  return null;
}

function parseYamlContent(content) {
  const yamlApi = getYamlApi();
  if (yamlApi && typeof content === "string" && /(^|\n)\s*proxies\s*:/m.test(content)) {
    const loader = yamlApi.safeLoad || yamlApi.load || yamlApi.parse;
    if (typeof loader === "function") {
      try {
        const parsed = loader.call(yamlApi, content);
        if (parsed && Array.isArray(parsed.proxies)) return parsed.proxies;
      } catch (error) {
        console.log(`[ClashMeta Fixer] WARN: YAML parse failed, fallback to inline JSON parsing: ${error.message}`);
      }
    }
  }

  const proxies = [];
  for (const line of String(content || "").split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*(\{.*\})\s*$/);
    if (!match) continue;
    try {
      proxies.push(JSON.parse(match[1]));
    } catch (error) {
      console.log(`[ClashMeta Fixer] WARN: inline JSON proxy parse failed: ${error.message}`);
    }
  }
  return proxies;
}

function toRecords(proxies) {
  return (Array.isArray(proxies) ? proxies : [])
    .map((proxy) => {
      const clean = cleanProxy(proxy);
      const name = String(clean.name || "");
      const type = normalizeType(clean.type);
      return {
        name,
        type,
        proxy: clean,
        region: regionOf(name),
        isInfo: isInfoNodeName(name),
      };
    })
    .filter((record) => record.name && SUPPORTED_TYPES.has(record.type));
}

function addProxyList(lines, names) {
  const list = names.length ? names : ["DIRECT"];
  for (const name of list) {
    lines.push(`      - ${yamlQuote(name)}`);
  }
}

function addSelectGroup(lines, name, names) {
  lines.push(`  - name: ${yamlQuote(name)}`);
  lines.push("    type: select");
  lines.push("    proxies:");
  addProxyList(lines, names);
}

function addHealthGroup(lines, name, type, names) {
  lines.push(`  - name: ${yamlQuote(name)}`);
  lines.push(`    type: ${type}`);
  lines.push(`    url: ${yamlQuote(PROBE_URL)}`);
  lines.push("    interval: 300");
  lines.push("    tolerance: 50");
  lines.push("    lazy: true");
  lines.push("    timeout: 5000");
  lines.push(`    expected-status: ${yamlQuote("204/200")}`);
  lines.push("    proxies:");
  addProxyList(lines, names);
}

function listOrDirect(names) {
  return names.length ? names : ["DIRECT"];
}

function selectGroupObject(name, names) {
  return {
    name,
    type: "select",
    proxies: listOrDirect(names),
  };
}

function healthGroupObject(name, type, names) {
  return {
    name,
    type,
    url: PROBE_URL,
    interval: 300,
    tolerance: 50,
    lazy: true,
    timeout: 5000,
    "expected-status": "204/200",
    proxies: listOrDirect(names),
  };
}

function normalizeRuleProfile(profile = RULE_PROFILE) {
  const text = String(profile || "").trim().toLowerCase();
  if (text === "stable") return "Stable";
  if (text === "rich") return "Rich";
  return "Hybrid";
}

function getDnsConfig() {
  return {
    enable: true,
    ipv6: false,
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "default-nameserver": ["223.5.5.5", "119.29.29.29", "114.114.114.114"],
    nameserver: ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query", "223.5.5.5", "119.29.29.29"],
    "fake-ip-filter": [
      "*.lan",
      "*.local",
      "localhost.ptlogin2.qq.com",
      "localhost.sec.qq.com",
      "time.*.com",
      "time.*.gov",
      "time.*.edu.cn",
      "time1.cloud.tencent.com",
      "time.ustc.edu.cn",
      "ntp.*.com",
      "ntp.aliyun.com",
      "ntp.tencent.com",
      "pool.ntp.org",
      "stun.*.*",
      "stun.*.*.*",
      "dns.msftncsi.com",
      "www.msftconnecttest.com",
      "connect.rom.miui.com",
      "router.asus.com",
      "tplogin.cn",
      "miwifi.com",
      "tendawifi.com",
    ],
  };
}

function addDnsConfig(lines) {
  const dns = getDnsConfig();
  lines.push("dns:");
  lines.push("  enable: true");
  lines.push("  ipv6: false");
  lines.push("  enhanced-mode: fake-ip");
  lines.push("  fake-ip-range: 198.18.0.1/16");
  lines.push("  default-nameserver:");
  for (const server of dns["default-nameserver"]) lines.push(`    - ${yamlQuote(server)}`);
  lines.push("  nameserver:");
  for (const server of dns.nameserver) lines.push(`    - ${yamlQuote(server)}`);
  lines.push("  fake-ip-filter:");
  for (const pattern of dns["fake-ip-filter"]) lines.push(`    - ${yamlQuote(pattern)}`);
}

function getRichRuleProviders() {
  const provider = (name, path, url) => ({
    type: "http",
    behavior: "domain",
    format: "yaml",
    path,
    url,
    interval: 86400,
  });

  return {
    cn: provider("cn", "./ruleset/cn.yaml", "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.yaml"),
    proxy: provider(
      "proxy",
      "./ruleset/proxy.yaml",
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/proxy.yaml"
    ),
    google: provider(
      "google",
      "./ruleset/google.yaml",
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.yaml"
    ),
    github: provider(
      "github",
      "./ruleset/github.yaml",
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/github.yaml"
    ),
    telegram: provider(
      "telegram",
      "./ruleset/telegram.yaml",
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.yaml"
    ),
    openai: provider(
      "openai",
      "./ruleset/openai.yaml",
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/openai.yaml"
    ),
    youtube: provider(
      "youtube",
      "./ruleset/youtube.yaml",
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/youtube.yaml"
    ),
    netflix: provider(
      "netflix",
      "./ruleset/netflix.yaml",
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/netflix.yaml"
    ),
    spotify: provider(
      "spotify",
      "./ruleset/spotify.yaml",
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/spotify.yaml"
    ),
    twitter: provider(
      "twitter",
      "./ruleset/twitter.yaml",
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/twitter.yaml"
    ),
  };
}

function addRichRuleProviders(lines) {
  const providers = getRichRuleProviders();
  lines.push("rule-providers:");
  for (const [name, provider] of Object.entries(providers)) {
    lines.push(`  ${name}:`);
    lines.push("    type: http");
    lines.push("    behavior: domain");
    lines.push("    format: yaml");
    lines.push(`    path: ${yamlQuote(provider.path)}`);
    lines.push(`    url: ${yamlQuote(provider.url)}`);
    lines.push("    interval: 86400");
  }
}

function getStableDirectRules() {
  return [
    "DOMAIN-SUFFIX,local,DIRECT",
    "DOMAIN-SUFFIX,localhost,DIRECT",
    "DOMAIN-SUFFIX,lan,DIRECT",
    "DOMAIN,localhost,DIRECT",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,169.254.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
    "IP-CIDR,224.0.0.0/4,DIRECT,no-resolve",
    "IP-CIDR6,::1/128,DIRECT,no-resolve",
    "IP-CIDR6,fc00::/7,DIRECT,no-resolve",
    "IP-CIDR6,fe80::/10,DIRECT,no-resolve",
    "DOMAIN-SUFFIX,cn,DIRECT",
    "DOMAIN-SUFFIX,中国,DIRECT",
    "DOMAIN-SUFFIX,公司,DIRECT",
    "DOMAIN-SUFFIX,网络,DIRECT",
    "DOMAIN-SUFFIX,gov.cn,DIRECT",
    "DOMAIN-SUFFIX,edu.cn,DIRECT",
    "DOMAIN-SUFFIX,ac.cn,DIRECT",
  ];
}

function getChinaDirectRules() {
  return [
    "DOMAIN-SUFFIX,baidu.com,DIRECT",
    "DOMAIN-SUFFIX,bdstatic.com,DIRECT",
    "DOMAIN-SUFFIX,baidubce.com,DIRECT",
    "DOMAIN-SUFFIX,qq.com,DIRECT",
    "DOMAIN-SUFFIX,weixin.qq.com,DIRECT",
    "DOMAIN-SUFFIX,wechat.com,DIRECT",
    "DOMAIN-SUFFIX,gtimg.com,DIRECT",
    "DOMAIN-SUFFIX,qpic.cn,DIRECT",
    "DOMAIN-SUFFIX,alicdn.com,DIRECT",
    "DOMAIN-SUFFIX,aliyun.com,DIRECT",
    "DOMAIN-SUFFIX,alipay.com,DIRECT",
    "DOMAIN-SUFFIX,taobao.com,DIRECT",
    "DOMAIN-SUFFIX,tmall.com,DIRECT",
    "DOMAIN-SUFFIX,mmstat.com,DIRECT",
    "DOMAIN-SUFFIX,jd.com,DIRECT",
    "DOMAIN-SUFFIX,360buyimg.com,DIRECT",
    "DOMAIN-SUFFIX,bilibili.com,DIRECT",
    "DOMAIN-SUFFIX,biliapi.net,DIRECT",
    "DOMAIN-SUFFIX,biliapi.com,DIRECT",
    "DOMAIN-SUFFIX,byteimg.com,DIRECT",
    "DOMAIN-SUFFIX,bytedance.com,DIRECT",
    "DOMAIN-SUFFIX,douyin.com,DIRECT",
    "DOMAIN-SUFFIX,ixigua.com,DIRECT",
    "DOMAIN-SUFFIX,toutiao.com,DIRECT",
    "DOMAIN-SUFFIX,weibo.com,DIRECT",
    "DOMAIN-SUFFIX,zhihu.com,DIRECT",
    "DOMAIN-SUFFIX,163.com,DIRECT",
    "DOMAIN-SUFFIX,126.com,DIRECT",
    "DOMAIN-SUFFIX,netease.com,DIRECT",
    "DOMAIN-SUFFIX,sina.com.cn,DIRECT",
    "DOMAIN-SUFFIX,xiaomi.com,DIRECT",
    "DOMAIN-SUFFIX,mi.com,DIRECT",
    "DOMAIN-SUFFIX,huawei.com,DIRECT",
    "DOMAIN-SUFFIX,hicloud.com,DIRECT",
    "DOMAIN-SUFFIX,meituan.com,DIRECT",
    "DOMAIN-SUFFIX,dianping.com,DIRECT",
    "DOMAIN-SUFFIX,pinduoduo.com,DIRECT",
    "DOMAIN-SUFFIX,yangkeduo.com,DIRECT",
    "DOMAIN-SUFFIX,amap.com,DIRECT",
    "DOMAIN-SUFFIX,autonavi.com,DIRECT",
    "DOMAIN-SUFFIX,12306.cn,DIRECT",
    "DOMAIN-SUFFIX,ccb.com,DIRECT",
    "DOMAIN-SUFFIX,icbc.com.cn,DIRECT",
    "DOMAIN-SUFFIX,abchina.com,DIRECT",
    "DOMAIN-SUFFIX,boc.cn,DIRECT",
    "DOMAIN-SUFFIX,bankcomm.com,DIRECT",
    "DOMAIN-SUFFIX,unionpay.com,DIRECT",
    "DOMAIN-SUFFIX,95516.com,DIRECT",
    "DOMAIN-SUFFIX,steamcontent.com,DIRECT",
    "DOMAIN-SUFFIX,steamserver.net,DIRECT",
    "DOMAIN-SUFFIX,apple.com.cn,DIRECT",
    "DOMAIN-SUFFIX,icloud.com.cn,DIRECT",
    "DOMAIN-SUFFIX,cdn-apple.com,DIRECT",
    "DOMAIN-SUFFIX,microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,windowsupdate.com,DIRECT",
    "DOMAIN-SUFFIX,msftconnecttest.com,DIRECT",
    "DOMAIN-SUFFIX,msftncsi.com,DIRECT",
  ];
}

function getForeignProxyRules() {
  return [
    `DOMAIN-SUFFIX,google.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,gstatic.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,googleapis.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,googlevideo.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,youtube.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,ytimg.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,github.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,githubusercontent.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,githubassets.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,telegram.org,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,t.me,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,openai.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,chatgpt.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,oaistatic.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,oaiusercontent.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,anthropic.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,claude.ai,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,gemini.google.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,ai.google.dev,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,discord.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,discordapp.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,x.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,twitter.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,twimg.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,facebook.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,fbcdn.net,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,instagram.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,threads.net,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,netflix.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,nflxvideo.net,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,spotify.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,scdn.co,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,steamcommunity.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,store.steampowered.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,tiktok.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,tiktokcdn.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,reddit.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,redd.it,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,cloudflare.com,${GROUP_PROXY}`,
    `DOMAIN-SUFFIX,vercel.app,${GROUP_PROXY}`,
  ];
}

function getRichRuleSetRules() {
  return [
    `RULE-SET,google,${GROUP_PROXY}`,
    `RULE-SET,github,${GROUP_PROXY}`,
    `RULE-SET,telegram,${GROUP_PROXY}`,
    `RULE-SET,openai,${GROUP_PROXY}`,
    `RULE-SET,youtube,${GROUP_PROXY}`,
    `RULE-SET,netflix,${GROUP_PROXY}`,
    `RULE-SET,spotify,${GROUP_PROXY}`,
    `RULE-SET,twitter,${GROUP_PROXY}`,
    `RULE-SET,proxy,${GROUP_PROXY}`,
    "RULE-SET,cn,DIRECT",
  ];
}

function getRules(profile = RULE_PROFILE) {
  const ruleProfile = normalizeRuleProfile(profile);
  const rules = [...getStableDirectRules()];
  if (ruleProfile !== "Stable") {
    rules.push(...getChinaDirectRules(), ...getForeignProxyRules());
  }
  if (ruleProfile === "Rich") {
    rules.push(...getRichRuleSetRules());
  }
  rules.push(`MATCH,${GROUP_PROXY}`);
  return rules;
}

function buildProfile(records, options = {}) {
  const ruleProfile = normalizeRuleProfile(options.ruleProfile);
  const main = records.filter((record) => !record.isInfo);
  const info = records.filter((record) => record.isInfo);
  if (!main.length) throw new Error("No usable proxy nodes remain after filtering.");

  const regionNames = {};
  for (const region of REGION_ORDER) {
    regionNames[region] = main.filter((record) => record.region === region).map((record) => record.name);
  }

  const activeRegions = REGION_ORDER.filter((region) => regionNames[region].length);
  const activeRegionGroups = activeRegions.map((region) => REGION_GROUP_NAMES[region]);

  const lines = [];
  lines.push("# Generated by SubStore-ClashMeta-Fixer.js");
  lines.push("# Target clients: Mihomo / Clash.Meta / FlClash");
  lines.push("mixed-port: 7890");
  lines.push("allow-lan: false");
  lines.push("mode: rule");
  lines.push("log-level: info");
  lines.push("ipv6: false");
  lines.push("unified-delay: true");
  lines.push("tcp-concurrent: true");
  lines.push("");
  addDnsConfig(lines);
  lines.push("");
  lines.push("proxies:");

  for (const record of [...main, ...info]) {
    lines.push(`  - ${JSON.stringify(record.proxy)}`);
  }

  lines.push("");
  lines.push("proxy-groups:");
  addSelectGroup(lines, GROUP_PROXY, [GROUP_MANUAL, GROUP_AUTO, GROUP_FALLBACK, ...activeRegionGroups, "DIRECT"]);
  addSelectGroup(lines, GROUP_MANUAL, main.map((record) => record.name));
  addHealthGroup(lines, GROUP_AUTO, "url-test", main.map((record) => record.name));
  addHealthGroup(lines, GROUP_FALLBACK, "fallback", main.map((record) => record.name));
  for (const region of activeRegions) {
    addSelectGroup(lines, REGION_GROUP_NAMES[region], regionNames[region]);
  }
  addSelectGroup(lines, GROUP_INFO, info.map((record) => record.name));

  lines.push("");
  if (ruleProfile === "Rich") {
    addRichRuleProviders(lines);
    lines.push("");
  }

  lines.push("rules:");
  for (const rule of getRules(ruleProfile)) {
    lines.push(`  - ${yamlQuote(rule)}`);
  }

  return `${lines.join("\n")}\n`;
}

function buildConfigObject(records, baseConfig = {}, options = {}) {
  const ruleProfile = normalizeRuleProfile(options.ruleProfile);
  const main = records.filter((record) => !record.isInfo);
  const info = records.filter((record) => record.isInfo);
  if (!main.length) throw new Error("No usable proxy nodes remain after filtering.");

  const regionNames = {};
  for (const region of REGION_ORDER) {
    regionNames[region] = main.filter((record) => record.region === region).map((record) => record.name);
  }

  const activeRegions = REGION_ORDER.filter((region) => regionNames[region].length);
  const activeRegionGroups = activeRegions.map((region) => REGION_GROUP_NAMES[region]);
  const mainNames = main.map((record) => record.name);

  const config = {
    ...baseConfig,
    "mixed-port": baseConfig["mixed-port"] ?? 7890,
    "allow-lan": baseConfig["allow-lan"] ?? false,
    mode: "rule",
    "log-level": baseConfig["log-level"] ?? "info",
    ipv6: baseConfig.ipv6 ?? false,
    "unified-delay": baseConfig["unified-delay"] ?? true,
    "tcp-concurrent": baseConfig["tcp-concurrent"] ?? true,
  };

  config.dns = getDnsConfig();
  config.proxies = [...main, ...info].map((record) => record.proxy);
  config["proxy-groups"] = [
    selectGroupObject(GROUP_PROXY, [GROUP_MANUAL, GROUP_AUTO, GROUP_FALLBACK, ...activeRegionGroups, "DIRECT"]),
    selectGroupObject(GROUP_MANUAL, mainNames),
    healthGroupObject(GROUP_AUTO, "url-test", mainNames),
    healthGroupObject(GROUP_FALLBACK, "fallback", mainNames),
    ...activeRegions.map((region) => selectGroupObject(REGION_GROUP_NAMES[region], regionNames[region])),
    selectGroupObject(GROUP_INFO, info.map((record) => record.name)),
  ];
  if (ruleProfile === "Rich") {
    config["rule-providers"] = getRichRuleProviders();
  } else {
    delete config["rule-providers"];
  }
  config.rules = getRules(ruleProfile);

  return config;
}

function main(config) {
  const records = toRecords(config && Array.isArray(config.proxies) ? config.proxies : []);
  if (!records.length) {
    console.log("[ClashMeta Fixer] WARN: main(config) found no usable proxy nodes, returning original config.");
    return config;
  }

  console.log(`[ClashMeta Fixer] OK: main(config) generated groups and rules for ${records.length} nodes.`);
  return buildConfigObject(records, config);
}

async function operator(proxies = [], targetPlatform, context) {
  if (proxies && (proxies.$file || typeof proxies.$content === "string")) {
    const fileObject = proxies;
    if (fileObject.$file && fileObject.$file.type !== "mihomoProfile") {
      console.log("[ClashMeta Fixer] WARN: file input is not a Mihomo profile, keeping original file.");
      return fileObject;
    }

    let records = [];
    if (typeof fileObject.$content === "string" && fileObject.$content.trim()) {
      records = toRecords(parseYamlContent(fileObject.$content));
    }

    if (!records.length && typeof produceArtifact === "function" && fileObject.$file) {
      const sourceType = fileObject.$file.sourceType || "collection";
      if (sourceType !== "none") {
        const artifact = await produceArtifact({
          type: sourceType,
          name: fileObject.$file.sourceName,
          platform: "mihomo",
          produceType: "internal",
          produceOpts: {
            "delete-underscore-fields": true,
          },
        });
        records = toRecords(artifact);
      }
    }

    if (!records.length) {
      console.log("[ClashMeta Fixer] WARN: file input has no usable proxy nodes, keeping original file.");
      return fileObject;
    }

    fileObject.$content = buildProfile(records);
    console.log(`[ClashMeta Fixer] OK: file operator generated full profile with ${records.length} nodes.`);
    return fileObject;
  }

  if (typeof $content !== "string") {
    console.log(
      "[ClashMeta Fixer] WARN: running in node-operation stage. This stage cannot add proxy-groups or rules. Move this script to a file/output/post script stage that exposes $content."
    );
    return proxies;
  }

  const parsedFromContent = parseYamlContent($content);
  const records = toRecords(parsedFromContent.length ? parsedFromContent : proxies);

  if (!records.length) {
    console.log("[ClashMeta Fixer] WARN: no usable nodes found, keeping original output.");
    return proxies;
  }

  const fixed = buildProfile(records);
  try {
    $content = fixed;
  } catch (error) {
    globalThis.$content = fixed;
  }

  console.log(`[ClashMeta Fixer] OK: generated full profile with ${records.length} nodes.`);
  return records.map((record) => record.proxy);
}

if (typeof module !== "undefined") {
  module.exports = {
    main,
    operator,
    buildConfigObject,
    buildProfile,
    getDnsConfig,
    getRules,
    normalizeRuleProfile,
    parseYamlContent,
    toRecords,
  };
}
