# Sub-Store ClashMeta Fixer

What is this? 

Used for repairing any or Sub-Store exported ClashMeta / Mihomo subscriptions. 

Some Sub-Store outputs only contain `proxies:`, without `proxy-groups:` and `rules:`. When this configuration is imported into FlClash / Clash.Meta / Mihomo, in the rule mode, there may be no proxy groups, no traffic splitting, and it may even seem that there are no available nodes. 

This tool will complete: 

- Original node
- Chinese strategy group
- Basic rules for domestic direct connection and other cases where traffic goes through a proxy server 

## Function 

- Fix the Sub-Store ClashMeta output that only contains `proxies:`.
- Automatically generate `proxy-groups:` and `rules:`.
- Retain Mihomo's commonly used nodes such as `trojan`, `vless`, `hysteria2`, `hy2`, etc.
- Automatically generate region groups based on node names.
- Place the refresh, expiration, traffic, etc. information nodes in `ℹ️ Subscription Information`, and do not include them in the main proxy group.
- Support both local Windows conversion and Sub-Store automatic conversion simultaneously. 

## File Description 

Explanation for the implementation and verification of the subsequent Agent. - `readme.md`
Current User Instructions. - `Generate-ClashMeta-Profile.bat`
- Windows double-click entry. - `Generate-ClashMeta-Profile.ps1`
Local core conversion script. - `SubStore-ClashMeta-Fixer.js`
Sub-Store panel script version. - `Output\`
- Local generation of directory. The generated subscription file will not be submitted to GitHub by default. 

## Method One: Local Manual Conversion 

Double-click: 

```bat
Generate-ClashMeta-Profile.bat
```


Or run it from the command line: 

```bat
Generate-ClashMeta-Profile.bat "<Subscription Link>" ```


Generated result: 

```text
Output\ClashMeta_Fixed.yaml
```


Just import this file into FlClash / Clash.Meta / Mihomo. 

## Method 2: Sub-Store Automatic Conversion 

If you don't want to manually copy the subscription link and run the `.bat` file every time, use: 

```text
SubStore-ClashMeta-Fixer.js
```


Recommendation Process: 

1. Keep the original subscription in the Sub-Store.
2. Select the output target as `ClashMeta`.
3. Go to `File`, create or edit a `Mihomo configuration` file.
4. Make this file reference the original subscription or combined subscription, such as `VPN_03`.
5. Place `SubStore-ClashMeta-Fixer.js` in the `JavaScript/YAML Overwrite` or script operation area on the file editing page.
6. Preview this file and confirm that there are `proxies:`, `proxy-groups:`, and `rules:` in the output.
7. Enter `Synchronization`, create a synchronization task, and let the synchronization task reference this file.
8. Copy the generated link of the synchronization task and fill this link into FlClash / Mihomo. 

Subsequently, every time the client refreshes the subscription, it will automatically obtain the fully repaired and complete configuration. 

Note: Do not limit this script to being used only in "Subscription Editing -> Node Operations -> Script Operations". In that stage, only node arrays can be handled and the final YAML cannot be modified, so it is impossible to add `proxy-groups:` and `rules:`. 

## As a subscription link 

The final recommendation is to use the link generated in the "Synchronization" section as the subscription link. 

The reason is: 

- The "file" is responsible for generating the repaired Mihomo/ClashMeta configuration.
- The "sync" is responsible for converting this file into a stable, replicable, and periodically refreshed subscription link.
- The file preview in the browser is merely for confirming the output content and is not the most convenient client subscription entry point. 

The link displayed in the Sub-Store synchronization pop-up window looks like: 

```text
http(s)://<your Sub-Store address>/api/file/<random file ID or synchronization ID> ```


Just paste this complete link into the subscription address of FlClash / Mihomo. 

If you suspect the cache, you can add the following after the link: 

```text
? noCache=1
```


## Check Before Uploading to GitHub 

Before submission, it is recommended to confirm: 

- Do not submit the actual subscription link, token, airport domain name, or private node information.
- Do not submit files such as `Output\ClashMeta_Fixed.yaml` that represent the generated results.
- The `.gitignore` file has already ignored the generated files in the `Output` directory, only keeping the directory placeholders.
- If you want to open source it, please choose and add an appropriate `LICENSE` file yourself. 

## Current Diversion Logic 

- Domestic domain name, `.cn`, common domestic services, local area network, private IP, China GeoIP -> `DIRECT`
- Other unmatched traffic -> `🚀 Node selection` 

This is not based on the app package name. Clash / Mihomo mainly divides based on domain name, IP and rule set. 

Strategy Team 

The generated configuration includes: 

- `🚀 Node Selection`
- `⚡ Automatic Speed Test`
- `🛟 Failover`
- `🇺🇸 US Node`
- `🇭🇰 Hong Kong Node`
- `🇯🇵 Japanese Node`
- `🇸🇬 Singapore Node`
- `🇹🇼 Taiwan Node`
- `🇰🇷 Korean Node`
- `🌐 Other Nodes`
- `ℹ️ Subscription Information` 

Note: `DIRECT` is an internal keyword of Clash / Mihomo and cannot be translated into Chinese.
