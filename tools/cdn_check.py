import os
from tencentcloud.common import credential
from tencentcloud.cdn.v20180606 import cdn_client, models
cred = credential.Credential(os.environ["COS_SECRET_ID"], os.environ["COS_SECRET_KEY"])
client = cdn_client.CdnClient(cred, "")
try:
    req = models.DescribeDomainsRequest()
    req.Offset = 0
    req.Limit = 100
    resp = client.DescribeDomains(req)
    print("=== CDN 域名列表 ===")
    if resp.Domains:
        for d in resp.Domains:
            print(f"  {d.Domain}  状态={d.Status}")
    else:
        print("  (账号下没有 CDN 域名)")
except Exception as e:
    print("查CDN域名失败:", e)
try:
    req2 = models.PurgeUrlsCacheRequest()
    req2.Urls = ["https://chubby-website-1515699183.cos-website.ap-shanghai.myqcloud.com/"]
    resp2 = client.PurgeUrlsCache(req2)
    print("CDN刷新结果:", resp2)
except Exception as e:
    print("CDN刷新失败:", e)