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
const PROBE_URL = "https://www.gstatic.com/generate_204";

const GROUP_PROXY = "🚀 节点选择";
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
    proxies: listOrDirect(names),
  };
}

function getRules() {
  return [
    "DOMAIN-SUFFIX,local,DIRECT",
    "DOMAIN-SUFFIX,localhost,DIRECT",
    "DOMAIN-SUFFIX,lan,DIRECT",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,169.254.0.0/16,DIRECT,no-resolve",
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
    "DOMAIN-SUFFIX,baidu.com,DIRECT",
    "DOMAIN-SUFFIX,bdstatic.com,DIRECT",
    "DOMAIN-SUFFIX,qq.com,DIRECT",
    "DOMAIN-SUFFIX,weixin.qq.com,DIRECT",
    "DOMAIN-SUFFIX,gtimg.com,DIRECT",
    "DOMAIN-SUFFIX,alicdn.com,DIRECT",
    "DOMAIN-SUFFIX,aliyun.com,DIRECT",
    "DOMAIN-SUFFIX,taobao.com,DIRECT",
    "DOMAIN-SUFFIX,tmall.com,DIRECT",
    "DOMAIN-SUFFIX,jd.com,DIRECT",
    "DOMAIN-SUFFIX,360buyimg.com,DIRECT",
    "DOMAIN-SUFFIX,bilibili.com,DIRECT",
    "DOMAIN-SUFFIX,biliapi.net,DIRECT",
    "DOMAIN-SUFFIX,byteimg.com,DIRECT",
    "DOMAIN-SUFFIX,bytedance.com,DIRECT",
    "DOMAIN-SUFFIX,douyin.com,DIRECT",
    "DOMAIN-SUFFIX,weibo.com,DIRECT",
    "DOMAIN-SUFFIX,zhihu.com,DIRECT",
    "DOMAIN-SUFFIX,163.com,DIRECT",
    "DOMAIN-SUFFIX,126.com,DIRECT",
    "DOMAIN-SUFFIX,netease.com,DIRECT",
    "DOMAIN-SUFFIX,sina.com.cn,DIRECT",
    "DOMAIN-SUFFIX,xiaomi.com,DIRECT",
    "DOMAIN-SUFFIX,huawei.com,DIRECT",
    "GEOSITE,private,DIRECT",
    "GEOSITE,cn,DIRECT",
    "GEOIP,private,DIRECT,no-resolve",
    "GEOIP,CN,DIRECT",
    `MATCH,${GROUP_PROXY}`,
  ];
}

function buildProfile(records) {
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
  lines.push("proxies:");

  for (const record of [...main, ...info]) {
    lines.push(`  - ${JSON.stringify(record.proxy)}`);
  }

  lines.push("");
  lines.push("proxy-groups:");
  addSelectGroup(lines, GROUP_PROXY, [GROUP_AUTO, GROUP_FALLBACK, ...activeRegionGroups, "DIRECT"]);
  addHealthGroup(lines, GROUP_AUTO, "url-test", main.map((record) => record.name));
  addHealthGroup(lines, GROUP_FALLBACK, "fallback", main.map((record) => record.name));
  for (const region of activeRegions) {
    addSelectGroup(lines, REGION_GROUP_NAMES[region], regionNames[region]);
  }
  addSelectGroup(lines, GROUP_INFO, info.map((record) => record.name));

  lines.push("");
  lines.push("rules:");
  for (const rule of getRules()) {
    lines.push(`  - ${rule}`);
  }

  return `${lines.join("\n")}\n`;
}

function buildConfigObject(records, baseConfig = {}) {
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

  config.proxies = [...main, ...info].map((record) => record.proxy);
  config["proxy-groups"] = [
    selectGroupObject(GROUP_PROXY, [GROUP_AUTO, GROUP_FALLBACK, ...activeRegionGroups, "DIRECT"]),
    healthGroupObject(GROUP_AUTO, "url-test", mainNames),
    healthGroupObject(GROUP_FALLBACK, "fallback", mainNames),
    ...activeRegions.map((region) => selectGroupObject(REGION_GROUP_NAMES[region], regionNames[region])),
    selectGroupObject(GROUP_INFO, info.map((record) => record.name)),
  ];
  config.rules = getRules();

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
  module.exports = { main, operator, buildConfigObject, buildProfile, parseYamlContent, toRecords };
}
