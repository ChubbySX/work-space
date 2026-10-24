import os
from tencentcloud.common import credential
from tencentcloud.cdn.v20180606 import cdn_client, models
cred=credential.Credential(os.environ["COS_SECRET_ID"],os.environ["COS_SECRET_KEY"])
client=cdn_client.CdnClient(cred,"")
try:
    req=models.DescribeDomainsRequest()
    req.Offset=0
    req.Limit=100
    resp=client.DescribeDomains(req)
    print("=== CDN 域名列表 ===")
    if resp.Domains:
        for d in resp.Domains:
            print(f"  {d.Domain}  状态={d.Status}  CNAME={d.Cname}")
    else:
        print("  (无CDN域名)")
except Exception as e:
    print("查CDN域名失败:", e)